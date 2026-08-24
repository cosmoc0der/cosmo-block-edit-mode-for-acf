/**
 * ACF Block Edit Mode.
 *
 * Adjustments for the ACF form, which (following the acf-pro-blocks build patch)
 * is once again rendered directly within the block—that is, inside the
 * editor canvas iframe.
 *
 * The fields themselves work fine: ACF attaches event handlers to the field's
 * `$el` rather than the `document`, so cross-document events do not interfere.
 * What needs fixing are elements that rely on coordinates or the parent
 * document's admin classes.
 */
( function ( $ ) {
	'use strict';

	if ( 'undefined' === typeof acf ) {
		return;
	}


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
	 * ACF buttons (.acf-button.button) rely on wp-admin styles attached to .wp-core-ui.
	 * The iframe lacks this class—React renders the body there (overwriting any
	 * added class)—so we tag the <html> element instead; as an ancestor, it
	 * functions identically for selectors like ".wp-core-ui .button".
	 */
	function markCanvas( $el ) {
		var doc = foreignDocument( $el );

		if ( doc && doc.documentElement ) {
			doc.documentElement.classList.add( 'wp-core-ui' );
		}
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
		}

		return args;
	} );

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
} )( jQuery );
