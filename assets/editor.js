/**
 * ACF Block Edit Mode.
 *
 * Adjustments for the ACF form, which (following the acf-pro-blocks build patch)
 * is once again rendered directly within the block—that is, inside the
 * editor canvas iframe.
 *
 * The fields themselves work fine: ACF attaches event handlers to the field's
 * `$el` rather than the `document`, so cross-document events do not interfere.
 * What needs fixing are elements that rely on coordinates, on the parent
 * document's admin classes, or on looking themselves up by id in `document`.
 */
( function ( $ ) {
	'use strict';

	if ( 'undefined' === typeof acf ) {
		return;
	}

	/**
	 * Canvas documents that currently hold an ACF form.
	 *
	 * @type {Document[]}
	 */
	var canvases = [];

	/**
	 * The iframe document, if the element is not located in the main document.
	 *
	 * @param {jQuery} $el
	 * @return {Document|null}
	 */
	function foreignDocument( $el ) {
		if ( ! $el || ! $el.length || ! $el[ 0 ].ownerDocument ) {
			return null;
		}

		var doc = $el[ 0 ].ownerDocument;

		return doc !== document ? doc : null;
	}

	/**
	 * Registers a canvas document and binds the handlers that WordPress itself
	 * delegates from the parent `document` (or `document.body`), and which
	 * therefore never see a click made inside the iframe.
	 *
	 * @param {Document} doc
	 * @return {void}
	 */
	function trackCanvas( doc ) {
		if ( ! doc || -1 !== canvases.indexOf( doc ) ) {
			return;
		}

		canvases.push( doc );

		// wp-admin/js/editor.js binds these to the parent document.
		$( doc ).on( 'click', '.wp-switch-editor', onSwitchEditor );

		// wp-includes/js/media-editor.js binds this to the parent body.
		$( doc ).on( 'click', '.insert-media', onInsertMedia );
	}

	/**
	 * ACF buttons (.acf-button.button) rely on wp-admin styles attached to .wp-core-ui.
	 * The iframe lacks this class—React renders the body there (overwriting any
	 * added class)—so we tag the <html> element instead; as an ancestor, it
	 * functions identically for selectors like ".wp-core-ui .button".
	 */
	function markCanvas( $el ) {
		var doc = foreignDocument( $el );

		if ( ! doc ) {
			return;
		}

		if ( doc.documentElement ) {
			doc.documentElement.classList.add( 'wp-core-ui' );
		}

		trackCanvas( doc );
	}

	acf.addAction( 'append', markCanvas );
	acf.addAction( 'remount', markCanvas );

	/**
	 * By default, Select2 (select, post_object, relationship) places the dropdown
	 * list in the parent document's <body> but derives its coordinates from an element
	 * inside the iframe, causing the list to become misaligned with the field.
	 * We keep the list within the same document.
	 */
	acf.addFilter( 'select2_args', function ( args, $select ) {
		var doc = foreignDocument( $select );

		if ( doc && doc.body ) {
			args.dropdownParent = $( doc.body );

			// Must be bound here, and only once per field - see onSelect2Open().
			$select.off( 'select2:open', onSelect2Open ).on( 'select2:open', onSelect2Open );
		}

		return args;
	} );

	/**
	 * Auto-focusing the search box of an open dropdown.
	 *
	 * ACF does that on `select2:open` through
	 * $( '.select2-container--open .select2-search__field' ).get( -1 ).focus() - a
	 * lookup in the parent document only. The dropdown of a field living in the
	 * canvas is not there, so the lookup yields undefined and .focus() throws.
	 *
	 * The exception lands in the middle of Select2's own `query` handler, right
	 * after it announces the open dropdown and before it asks the data adapter for
	 * results - so the request is never made. An AJAX-driven field (post_object,
	 * taxonomy, user, page_link, a select with a custom query) is left hanging on
	 * "Searching..." forever, and a plain one never receives its options.
	 *
	 * ACF binds its handler in Select2_4.initialize(), immediately after the
	 * `select2_args` filter has run; binding ours from that filter therefore puts it
	 * first in the queue, and stopping the event right there keeps the broken
	 * handler from ever running.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onSelect2Open( e ) {
		e.stopImmediatePropagation();

		var doc = e.target.ownerDocument;

		if ( ! doc ) {
			return;
		}

		// The dropdown is appended to the end of <body>, so it is the last match;
		// an earlier one would be the search box of a multi-select field itself.
		var $search = $( doc ).find(
			'.select2-container--open .select2-search__field'
		);

		$search.last().trigger( 'focus' );
	}

	/**
	 * Tooltips and deletion confirmations ("Are you sure?" for repeater rows)
	 * ACF appends these to the parent document's <body> and positions them
	 * based on the target's offset(). For targets inside an iframe, we move
	 * the tooltip into the iframe as well and recalculate its position.
	 */
	var newTooltip = acf.newTooltip;

	acf.newTooltip = function ( props ) {
		var tooltip = newTooltip.apply( this, arguments );

		if ( ! tooltip || ! tooltip.$el || ! tooltip.$el.length ) {
			return tooltip;
		}

		var doc = foreignDocument( tooltip.get( 'target' ) );

		if ( doc && doc.body ) {
			doc.body.appendChild( tooltip.$el[ 0 ] );

			if ( 'function' === typeof tooltip.position ) {
				tooltip.position();
			}
		}

		return tooltip;
	};

	/**
	 * The WYSIWYG field.
	 *
	 * TinyMCE, Quicktags and the Visual/Text switcher all run in the parent
	 * document and resolve the editor by id through document.getElementById().
	 * For a textarea living in the canvas those lookups return null, and none of
	 * that code handles the miss:
	 *
	 *   - quicktags() is a constructor, so its `return false` still yields an
	 *     object—one with no `settings`—and ACF's buildQuicktags() dies on
	 *     "Cannot read properties of undefined (reading 'buttons')";
	 *   - tinymce.init() resolves "#id" with querySelectorAll() on the parent
	 *     document, finds nothing and silently initialises no editor.
	 *
	 * The field is then left as the bare textarea underneath the (already
	 * removed) "Click to initialize TinyMCE" placeholder.
	 *
	 * Two adjustments are enough: let id lookups in the parent document fall
	 * back to the canvas documents, and hand TinyMCE the textarea element
	 * itself instead of a selector it would run against the wrong document.
	 */
	var lookupPatched = false;

	/**
	 * Makes document.getElementById() fall back to the canvas documents.
	 *
	 * The patch is purely additive—it only ever resolves ids that the parent
	 * document does not have—and is installed lazily, on the first editor that
	 * is actually initialised inside a canvas.
	 *
	 * @return {void}
	 */
	function patchLookup() {
		if ( lookupPatched ) {
			return;
		}

		lookupPatched = true;

		var getElementById = document.getElementById;

		document.getElementById = function ( id ) {
			var el = getElementById.call( document, id );

			for ( var i = 0; ! el && i < canvases.length; i++ ) {
				// Skip documents whose iframe has already been torn down.
				if ( canvases[ i ].defaultView ) {
					el = canvases[ i ].getElementById( id );
				}
			}

			return el;
		};
	}

	if ( acf.tinymce ) {
		var initializeEditor = acf.tinymce.initialize;

		acf.tinymce.initialize = function ( id, args ) {
			var field = args && args.field;
			var doc = field ? foreignDocument( field.$el ) : null;

			if ( doc ) {
				trackCanvas( doc );
				patchLookup();
			}

			return initializeEditor.apply( this, arguments );
		};
	}

	acf.addFilter( 'wysiwyg_tinymce_settings', function ( settings, id, field ) {
		if ( ! field || ! foreignDocument( field.$el ) ) {
			return settings;
		}

		var textarea = field.$input()[ 0 ];

		if ( textarea ) {
			// tinymce.init() prefers `selector` over `target`, so it has to go.
			settings.target = textarea;
			delete settings.selector;
		}

		return settings;
	} );

	/**
	 * Visual/Text tabs.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onSwitchEditor( e ) {
		var $button = $( this );
		var id = $button.attr( 'data-wp-editor-id' );

		if ( ! id || ! acf.isset( window, 'switchEditors', 'go' ) ) {
			return;
		}

		window.switchEditors.go( id, $button.hasClass( 'switch-tmce' ) ? 'tmce' : 'html' );
	}

	/**
	 * The "Add Media" button of a WYSIWYG field. The modal itself belongs to the
	 * parent document, which is exactly where wp.media puts it.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onInsertMedia( e ) {
		var $button = $( this );

		if ( ! acf.isset( window, 'wp', 'media', 'editor', 'open' ) ) {
			return;
		}

		e.preventDefault();

		var gallery = $button.hasClass( 'gallery' );
		var l10n = acf.isset( window, 'wp', 'media', 'view', 'l10n' ) ? wp.media.view.l10n : {};

		wp.media.editor.open( $button.attr( 'data-editor' ), {
			frame: 'post',
			state: gallery ? 'gallery' : 'insert',
			title: gallery ? l10n.createGalleryTitle : l10n.addMedia,
			multiple: true,
		} );
	}
} )( jQuery );
