/**
 * ACF Block Edit Mode.
 *
 * Adjustments for the ACF form, which (following the acf-pro-blocks build patch)
 * is once again rendered directly within the block—that is, inside the
 * editor canvas iframe.
 *
 * The fields themselves mostly work: ACF attaches their event handlers to the
 * field's `$el`. What needs fixing is whatever still counts on the parent
 * document - handlers delegated from it, popups appended to its <body> and
 * positioned against its window, lookups by id or selector in it.
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
	 * Registers a canvas document and binds what the form expects to receive
	 * through the parent document, which events from the iframe never reach.
	 *
	 * @param {Document} doc
	 * @return {void}
	 */
	function trackCanvas( doc ) {
		if ( ! doc || -1 !== canvases.indexOf( doc ) ) {
			return;
		}

		canvases.push( doc );

		$( doc )
			.on( 'click mousedown change', relay )
			.on( 'click', '.wp-switch-editor', onSwitchEditor )
			.on( 'click', '.insert-media', onInsertMedia )
			.on( 'keydown keyup', onShiftKey )
			.on( 'sortstart sortstop', onSort );
	}

	/**
	 * Hands a canvas event to the jQuery handlers of the parent document, the way
	 * it would bubble up to them if the form was not in an iframe.
	 *
	 * A good deal of what the form relies on is delegated from there: the accordion
	 * toggle and the other global ACF models, every legacy acf.model /
	 * acf.field.extend() handler, and the "Are you sure?" and Flexible Content
	 * popups and the jQuery UI datepicker closing on an outside click.
	 *
	 * Handlers delegated from the parent <body> stay out of reach: jQuery only
	 * matches their selectors against descendants of that <body>.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function relay( e ) {
		// Wrapping the jQuery event rather than the native one keeps those ACF fires
		// itself through .trigger( 'change' ), which have no native counterpart.
		var event = $.Event( e );

		// The selector engine keeps the document of its last query, and matching
		// delegated selectors against the parent one only works while that is it.
		// Any query on the canvas - $( e.target ).closest(), say - switches it over.
		$.find.matchesSelector( document.documentElement, 'html' );

		$.event.dispatch.call( document, event );
	}

	/**
	 * Holding Shift swaps the repeater's "add row" icon for "duplicate row".
	 *
	 * ACF toggles the class behind that on the parent <body>, while the rows it
	 * styles are in the canvas.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onShiftKey( e ) {
		if ( 16 === e.keyCode && this.body ) {
			$( this.body ).toggleClass( 'acf-keydown-shift', 'keydown' === e.type );
		}
	}

	/**
	 * jQuery UI's sortstart/sortstop, which ACF turns into actions of the same name
	 * from the parent document. Without them a dragged repeater or Flexible Content
	 * row is never unmounted and remounted, which is what keeps its WYSIWYG editors
	 * from coming out of the drop blank.
	 *
	 * @param {Event}  e
	 * @param {Object} ui
	 * @return {void}
	 */
	function onSort( e, ui ) {
		acf.doAction( e.type, ui.item, ui.placeholder );
	}

	/**
	 * Runs a function with `$( window )` measuring the given window instead.
	 *
	 * ACF and Select2 position their popups against `$( window )` - always the
	 * parent one - while taking the target's offsets from the canvas, so whether
	 * there is room above or below is answered for the wrong viewport. Replaying
	 * their own code this way spares copying it.
	 *
	 * @param {Window}   view
	 * @param {Function} fn
	 * @param {Object}   context
	 * @return {*}
	 */
	function inViewport( view, fn, context ) {
		function measure( original ) {
			return function () {
				return original.apply( this[ 0 ] === window ? $( view ) : this, arguments );
			};
		}

		return withWrapped( { scrollTop: measure, width: measure, height: measure }, fn, context );
	}

	/**
	 * Runs a function with some jQuery methods wrapped for the duration of the call.
	 *
	 * @param {Object<string, Function>} wrappers Method name => function( original ) returning its replacement.
	 * @param {Function}                 fn
	 * @param {Object}                   context
	 * @param {Array|Arguments}          [args]
	 * @return {*}
	 */
	function withWrapped( wrappers, fn, context, args ) {
		var originals = {};

		$.each( wrappers, function ( name, wrap ) {
			originals[ name ] = $.fn[ name ];
			$.fn[ name ] = wrap( originals[ name ] );
		} );

		try {
			return fn.apply( context, args );
		} finally {
			$.extend( $.fn, originals );
		}
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
	 * Auto-focusing the search box of an open dropdown, plus the corrections
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
		adoptInfiniteScroll( select2 );

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
	 *   - _positionDropdown() measures the viewport through `$( window )` - see
	 *     inViewport() - so the list flips above the field for no reason.
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

		var position = Object.getPrototypeOf( dropdown )._positionDropdown;

		// An own property, so only this field's adapter is affected; Select2 keeps
		// calling it on results:all, results:append, select and unselect.
		dropdown._positionDropdown = function () {
			var view = this.$dropdownParent[ 0 ].ownerDocument.defaultView;

			if ( view ) {
				inViewport( view, position, this );
			}
		};

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
	 * Paging of AJAX results ("Loading more results...").
	 *
	 * InfiniteScroll only loads the next page while its "Loading more" row is
	 * attached, and checks that with $.contains( document.documentElement, ... ) -
	 * the parent document. A row inside the canvas never passes, so the list stops
	 * at the first page.
	 *
	 * append() looks the method up on the instance, so an own property covers it;
	 * the scroll handler was bound to the original in bind(), hence the extra one.
	 *
	 * @param {Object|undefined} select2 Select2 instance, as stored on the <select>.
	 * @return {void}
	 */
	function adoptInfiniteScroll( select2 ) {
		var results = select2 && select2.results;

		// Not the InfiniteScroll adapter - the field has no paging to fix.
		if ( ! results || ! results.$loadingMore || ! results.$results ) {
			return;
		}

		results.loadMoreIfNeeded = loadMoreIfNeeded;

		results.$results
			.off( 'scroll.cosmoBlockEditMode' )
			.on( 'scroll.cosmoBlockEditMode', function () {
				results.loadMoreIfNeeded();
			} );
	}

	/**
	 * InfiniteScroll.prototype.loadMoreIfNeeded(), checking the row against the
	 * document it actually lives in.
	 *
	 * @this {Object} The InfiniteScroll-decorated results adapter.
	 * @return {void}
	 */
	function loadMoreIfNeeded() {
		var row = this.$loadingMore[ 0 ];

		if ( this.loading || ! row || ! row.isConnected ) {
			return;
		}

		var currentOffset = this.$results.offset().top + this.$results.outerHeight( false );
		var loadingMoreOffset = this.$loadingMore.offset().top + this.$loadingMore.outerHeight( false );

		if ( currentOffset + 50 >= loadingMoreOffset ) {
			this.loadMore();
		}
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
		if ( foreignDocument( $el ) ) {
			closeLists( $el );
		}
	}

	acf.addAction( 'unmount', closeSelect2 );

	/**
	 * Closing open lists on a mousedown outside of them.
	 *
	 * Select2 does that from a handler on the parent <body>, which only sees
	 * mousedowns made in the parent document and only looks for open lists there.
	 * Mousedowns inside a list never get this far - Select2 stops them on the
	 * dropdown - and those from the canvas arrive through relay().
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onOutsideMousedown( e ) {
		var own = $( e.target ).closest( '.select2' )[ 0 ];

		[ document ].concat( canvases ).forEach( function ( doc ) {
			if ( doc.defaultView ) {
				closeLists( $( doc ), own );
			}
		} );
	}

	$( document ).on( 'mousedown', onOutsideMousedown );

	/**
	 * @param {jQuery}       $root  Where to look for the fields.
	 * @param {Element|void} except Select2 container to leave open.
	 * @return {void}
	 */
	function closeLists( $root, except ) {
		$root.find( 'select' ).each( function () {
			var select2 = $( this ).data( 'select2' );

			if (
				select2 &&
				'function' === typeof select2.isOpen &&
				select2.isOpen() &&
				select2.$container[ 0 ] !== except
			) {
				select2.close();
			}
		} );
	}

	/**
	 * Tooltips, deletion confirmations ("Are you sure?" for repeater rows) and the
	 * Flexible Content layout popups.
	 *
	 * ACF appends all of them to the parent <body> and positions them from the
	 * target's offset() - taken in the canvas - and `$( window )`. For a target in
	 * the canvas the popup is moved in there and positioned again. Flexible Content
	 * creates its popups directly rather than through acf.newTooltip(), so this has
	 * to happen in the constructor they all share.
	 */
	if ( acf.models && acf.models.Tooltip ) {
		var initializeTooltip = acf.models.Tooltip.prototype.initialize;

		acf.models.Tooltip.prototype.initialize = function () {
			initializeTooltip.apply( this, arguments );

			var doc = foreignDocument( this.get( 'target' ) );

			if ( doc && doc.body && doc.defaultView ) {
				doc.body.appendChild( this.$el[ 0 ] );
				inViewport( doc.defaultView, this.position, this );
			}
		};
	}

	/**
	 * The jQuery UI datepicker behind the date, date-time and time fields.
	 *
	 * For an input in the canvas it never opened at all: the private
	 * datepicker_getZindex() climbs the input's ancestors until it meets
	 * `document` - the parent one - so it runs past the canvas <html>, asks the
	 * canvas document for its styles and jQuery throws. The z-index it is after
	 * does not matter here, ACF sets its own with !important.
	 *
	 * Past that, it has a single calendar for the whole page, kept in the parent
	 * <body>, and places it at the input's offset() - a canvas one. The calendar is
	 * therefore moved to whichever document the input being opened belongs to,
	 * together with the .acf-ui-datepicker wrapper its styles are scoped to.
	 */
	if ( $.datepicker ) {
		var showDatepicker = $.datepicker._showDatepicker;
		var checkOffset = $.datepicker._checkOffset;

		$.datepicker._showDatepicker = function ( input ) {
			var doc = ( input.target || input ).ownerDocument;
			var $calendar = $.datepicker.dpDiv;
			var $wrapper = $calendar.parent( '.acf-ui-datepicker' );
			var node = ( $wrapper.length ? $wrapper : $calendar )[ 0 ];

			if ( doc && doc.body && node && node.ownerDocument !== doc ) {
				doc.body.appendChild( node );
			}

			if ( ! doc || doc === document ) {
				return showDatepicker.apply( this, arguments );
			}

			return withWrapped( { css: skipDocuments }, showDatepicker, this, arguments );
		};

		$.datepicker._checkOffset = function ( inst ) {
			var input = inst.input && inst.input[ 0 ];
			var doc = input && input.ownerDocument;

			return doc && doc !== document
				? checkCanvasOffset.apply( this, arguments )
				: checkOffset.apply( this, arguments );
		};
	}

	/**
	 * @param {Function} original $.fn.css
	 * @return {Function}
	 */
	function skipDocuments( original ) {
		return function () {
			return this[ 0 ] && 9 === this[ 0 ].nodeType ? undefined : original.apply( this, arguments );
		};
	}

	/**
	 * $.datepicker._checkOffset() - keeping the calendar inside the viewport - with
	 * the viewport taken from the input's document instead of the parent one.
	 *
	 * @this {Object} $.datepicker
	 * @param {Object}  inst
	 * @param {Object}  offset
	 * @param {boolean} isFixed
	 * @return {Object}
	 */
	function checkCanvasOffset( inst, offset, isFixed ) {
		var doc = inst.input[ 0 ].ownerDocument;
		var $doc = $( doc );
		var dpWidth = inst.dpDiv.outerWidth();
		var dpHeight = inst.dpDiv.outerHeight();
		var inputWidth = inst.input.outerWidth();
		var inputHeight = inst.input.outerHeight();
		var viewWidth = doc.documentElement.clientWidth + ( isFixed ? 0 : $doc.scrollLeft() );
		var viewHeight = doc.documentElement.clientHeight + ( isFixed ? 0 : $doc.scrollTop() );

		offset.left -= this._get( inst, 'isRTL' ) ? dpWidth - inputWidth : 0;
		offset.left -= isFixed && offset.left === inst.input.offset().left ? $doc.scrollLeft() : 0;
		offset.top -= isFixed && offset.top === inst.input.offset().top + inputHeight ? $doc.scrollTop() : 0;

		offset.left -= Math.min(
			offset.left,
			offset.left + dpWidth > viewWidth && viewWidth > dpWidth ? Math.abs( offset.left + dpWidth - viewWidth ) : 0
		);
		offset.top -= Math.min(
			offset.top,
			offset.top + dpHeight > viewHeight && viewHeight > dpHeight ? Math.abs( dpHeight + inputHeight ) : 0
		);

		return offset;
	}

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

	/**
	 * Protect TinyMCE selection logic inside iframe canvases.
	 * When the editor is rendered inside an iframe, window.getSelection() can return null,
	 * causing wp-tinymce.js to throw "Cannot read properties of null (reading 'setBaseAndExtent')".
	 */
	function patchTinyMCESelection() {
		if ( window.tinymce && window.tinymce.dom && window.tinymce.dom.Selection ) {
			if ( ! window.tinymce.dom.Selection.prototype._cosmoSelectPatched ) {
				var origSelect = window.tinymce.dom.Selection.prototype.select;
				window.tinymce.dom.Selection.prototype.select = function ( node, content ) {
					try {
						var win = this.getWin();
						if ( ! win || ! win.getSelection || ! win.getSelection() ) {
							return;
						}
						return origSelect.apply( this, arguments );
					} catch ( err ) {
						return;
					}
				};
				window.tinymce.dom.Selection.prototype._cosmoSelectPatched = true;
			}
		}
	}

	patchTinyMCESelection();

	if ( acf.tinymce ) {
		var initializeEditor = acf.tinymce.initialize;

		acf.tinymce.initialize = function ( id, args ) {
			var field = args && args.field;
			var doc = field ? foreignDocument( field.$el ) : null;

			if ( doc ) {
				trackCanvas( doc );
				patchLookup();
				patchTinyMCESelection();
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
	 * wp-admin/js/editor.js listens for them on the parent document through
	 * tinymce.$ rather than jQuery, which relay() cannot reach.
	 *
	 * @param {Event} e
	 * @return {void}
	 */
	function onSwitchEditor( e ) {
		e.preventDefault();

		var $button = $( this );
		var id = $button.attr( 'data-wp-editor-id' );

		if ( ! id || ! acf.isset( window, 'switchEditors', 'go' ) ) {
			return;
		}

		try {
			window.switchEditors.go( id, $button.hasClass( 'switch-tmce' ) ? 'tmce' : 'html' );
		} catch ( err ) {
			// Silently absorb selection errors during iframe editor mode switch.
		}
	}

	/**
	 * The "Add Media" button of a WYSIWYG field. The modal itself belongs to the
	 * parent document, which is exactly where wp.media puts it.
	 *
	 * wp-includes/js/media-editor.js delegates it from the parent <body> - see relay().
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
