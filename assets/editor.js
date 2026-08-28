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
	 * Auto-focusing the search box of an open dropdown, plus the two corrections
	 * Select2 needs once its dropdown lives in a canvas document.
	 *
	 * The focusing part: ACF does that on `select2:open` through
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

		var $select = $( e.target );
		var select2 = $select.data( 'select2' );

		adoptDropdown( select2, doc );
		followCanvas( select2, $select );

		// The dropdown is appended to the end of <body>, so it is the last match;
		// an earlier one would be the search box of a multi-select field itself.
		var $search = $( doc ).find(
			'.select2-container--open .select2-search__field'
		);

		$search.last().trigger( 'focus' );
	}

	/**
	 * Hands the open dropdown over to the document the field is currently in.
	 *
	 * Select2 has already appended and positioned the list by the time the
	 * `select2:open` DOM event fires - the internal `open` listeners run first (see
	 * Observable.trigger, which invokes the named listeners before the '*' relay
	 * that produces the DOM event) - so both corrections happen after the fact.
	 *
	 * What has to be corrected:
	 *
	 *   - AttachBody stores `dropdownParent` once, in its constructor. A form that
	 *     is rebuilt in another document keeps pointing at the <body> it was born
	 *     with, and drops its list into a document the field no longer belongs to.
	 *   - _positionDropdown() measures the viewport through `$( window )`, which is
	 *     always the parent window, while the offsets it compares against come from
	 *     the iframe. The "is there room below?" test is answered for the wrong
	 *     scroll position, so the list flips above the field for no reason.
	 *
	 * @param {Object|undefined} select2 Select2 instance, as stored on the <select>.
	 * @param {Document}         doc     Document the field currently lives in.
	 * @return {void}
	 */
	function adoptDropdown( select2, doc ) {
		var dropdown = select2 && select2.dropdown;

		// Not the AttachBody adapter - there is no detached list to correct.
		if ( ! dropdown || ! dropdown.$dropdownContainer || ! dropdown.$dropdownParent ) {
			return;
		}

		if (
			dropdown.$dropdownParent.length &&
			dropdown.$dropdownParent[ 0 ].ownerDocument !== doc
		) {
			dropdown.$dropdownParent = $( doc.body );
			dropdown.$dropdownContainer.appendTo( dropdown.$dropdownParent );
		}

		// An own property, so only this field's adapter is affected; Select2 keeps
		// calling it on results:all, results:append, select and unselect.
		dropdown._positionDropdown = positionDropdown;

		dropdown._positionDropdown();
		dropdown._resizeDropdown();
	}

	/**
	 * Keeps the list under its field while the canvas scrolls.
	 *
	 * AttachBody repositions on scroll and resize of `window` - the parent one -
	 * and freezes whichever scrollable ancestors it can see. Neither reaches the
	 * canvas: it scrolls its own <html>, which has plain `overflow: visible` and so
	 * is not recognised as scrollable, and its window is not the one being watched.
	 * A list opened there would simply stay put while the field scrolled away from
	 * underneath it.
	 *
	 * @param {Object|undefined} select2 Select2 instance, as stored on the <select>.
	 * @param {jQuery}           $select The field's <select>.
	 * @return {void}
	 */
	function followCanvas( select2, $select ) {
		var dropdown = select2 && select2.dropdown;
		var parent = dropdown && dropdown.$dropdownParent && dropdown.$dropdownParent[ 0 ];
		var view = parent && parent.ownerDocument && parent.ownerDocument.defaultView;

		if ( ! view || view === window ) {
			return;
		}

		// Per field, so that closing one list cannot unbind another's handler.
		var ns = '.cosmoBlockEditMode' + String( select2.id ).replace( /\W/g, '' );
		var $view = $( view );

		$view.off( ns ).on( 'scroll' + ns + ' resize' + ns, function () {
			dropdown._positionDropdown();
			dropdown._resizeDropdown();
		} );

		$select.one( 'select2:close', function () {
			$view.off( ns );
		} );
	}

	/**
	 * AttachBody.prototype._positionDropdown(), measuring the viewport in the
	 * document the dropdown was placed in rather than in the parent one.
	 *
	 * @this {Object} The AttachBody-decorated dropdown adapter.
	 * @return {void}
	 */
	function positionDropdown() {
		var parent = this.$dropdownParent[ 0 ];
		var view = parent && parent.ownerDocument && parent.ownerDocument.defaultView;

		if ( ! view ) {
			return;
		}

		var $view = $( view );
		var isAbove = this.$dropdown.hasClass( 'select2-dropdown--above' );
		var isBelow = this.$dropdown.hasClass( 'select2-dropdown--below' );
		var offset = this.$container.offset();
		var containerHeight = this.$container.outerHeight( false );
		var dropdownHeight = this.$dropdown.outerHeight( false );
		var viewportTop = $view.scrollTop();
		var viewportBottom = viewportTop + $view.height();
		var roomAbove = viewportTop < offset.top - dropdownHeight;
		var roomBelow =
				viewportBottom > offset.top + containerHeight + dropdownHeight;
		var direction = null;

		// A statically positioned parent does not anchor the absolute list itself;
		// the offsets to subtract are then its own offset parent's.
		var $offsetParent = this.$dropdownParent;

		if ( 'static' === $offsetParent.css( 'position' ) ) {
			$offsetParent = $offsetParent.offsetParent();
		}

		var parentOffset = ( $offsetParent.length && $offsetParent.offset() ) || {
			top: 0,
			left: 0,
		};

		if ( ! isAbove && ! isBelow ) {
			direction = 'below';
		}

		if ( ! roomBelow && roomAbove && ! isAbove ) {
			direction = 'above';
		} else if ( ! roomAbove && roomBelow && isAbove ) {
			direction = 'below';
		}

		var css = {
			left: offset.left - parentOffset.left,
			top: offset.top + containerHeight - parentOffset.top,
		};

		if ( 'above' === direction || ( isAbove && 'below' !== direction ) ) {
			css.top = offset.top - parentOffset.top - dropdownHeight;
		}

		if ( direction ) {
			this.$dropdown
				.removeClass( 'select2-dropdown--below select2-dropdown--above' )
				.addClass( 'select2-dropdown--' + direction );
			this.$container
				.removeClass( 'select2-container--below select2-container--above' )
				.addClass( 'select2-container--' + direction );
		}

		this.$dropdownContainer.css( css );
	}

	/**
	 * Closing the lists of a form that is going away.
	 *
	 * ACF destroys Select2 from onRemove(), which only the `remove` action reaches.
	 * A block form is not removed, it is unmounted - React simply drops the node -
	 * and the dropdown container does not live inside that node but at the end of
	 * <body>. An open list would therefore be left behind, floating over the canvas
	 * with nothing under it.
	 *
	 * @param {jQuery} $el The form being unmounted.
	 * @return {void}
	 */
	function closeSelect2( $el ) {
		if ( ! foreignDocument( $el ) ) {
			return;
		}

		$el.find( 'select' ).each( function () {
			var select2 = $( this ).data( 'select2' );

			if ( select2 && 'function' === typeof select2.close ) {
				select2.close();
			}
		} );
	}

	acf.addAction( 'unmount', closeSelect2 );

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
