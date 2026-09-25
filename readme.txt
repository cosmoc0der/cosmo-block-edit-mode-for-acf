=== Cosmo Block Edit Mode for ACF ===
Contributors: bakhods
Tags: block editor, custom fields, blocks, inline editing, editor
Requires at least: 6.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.8
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Brings back the "Switch to Edit / Switch to Preview" toggle and the field form inside ACF blocks, instead of only in the sidebar.

== Description ==

Since the post editor canvas is always rendered inside an iframe, Advanced Custom Fields forces every ACF block into preview mode: the toolbar toggle disappears and the field form is pushed into the sidebar. There is no filter or setting to turn that behaviour off.

This plugin restores the previous experience. The toolbar toggle comes back and the fields are edited in place, inside the block, exactly where the content is.

Cosmo Block Edit Mode for ACF is an independent, unofficial plugin. "ACF" and "Advanced Custom Fields" are trademarks of WP Engine; this plugin is not affiliated with, endorsed by, or sponsored by WP Engine or the Advanced Custom Fields team, and the name refers to that plugin solely to describe what this one works with.

= How it works =

The plugin builds a patched copy of the ACF blocks script on the fly. The only change is one internal "is the editor iframed?" check, which is made to always return false. The copy is stored in `wp-content/uploads/cosmo-block-edit-mode-for-acf/` and its file name is derived from the ACF version and the source file, so it is rebuilt automatically after every ACF update.

If a future ACF release rewrites that part of the code, the plugin silently serves the untouched original and shows a warning in the admin area. Your site never breaks - it simply falls back to the current ACF behaviour.

Some extra styling and a small companion script are loaded inside the canvas iframe, because the iframe does not inherit the wp-admin stylesheets that ACF fields depend on. These also fix everything that breaks once a field lives in a different document than the scripts driving it: select2 dropdowns, tooltip placement, and the WYSIWYG field - TinyMCE, Quicktags, the Visual/Text tabs and the Add Media button.

= Requirements =

This plugin requires **ACF PRO**, a commercial plugin sold separately by WP Engine and not distributed through WordPress.org. Blocks are a PRO-only feature. With ACF PRO inactive, this plugin does nothing at all.

This plugin is not affiliated with, endorsed by, or sponsored by WP Engine or the Advanced Custom Fields team.

= Developers =

Turn the patch off without deactivating the plugin:

`add_filter( 'cosmo/block_edit_mode_for_acf/enabled', '__return_false' );`

== Installation ==

1. Install and activate ACF PRO.
2. Upload the plugin through **Plugins - Add New - Upload Plugin**, or install it from the plugin directory.
3. Activate **Cosmo Block Edit Mode for ACF**.
4. Open a post containing an ACF block - the mode toggle is back in the block toolbar.

== Frequently Asked Questions ==

= Does this modify the ACF plugin files? =

No. The ACF installation is left untouched. A patched copy of one script is generated in the uploads folder and served instead of the original, only inside the admin area.

= What happens when ACF updates? =

The patched copy is keyed to the ACF version and rebuilt automatically. If the code it patches has changed too much to recognise, the original script is served and an admin notice asks you to update this plugin.

= Does it work with the free version of ACF? =

No. ACF blocks are a PRO-only feature, so there is nothing to patch in the free version.

= What is left behind when I delete the plugin? =

Nothing. Deleting the plugin removes the generated cache folder in `wp-content/uploads/` and the internal flag it uses.

== Changelog ==

= 1.0.8 =
* Fixed the editor jumping to a block with a WYSIWYG field while working elsewhere in the post. A block remounts its form whenever a block is added or removed above it - pressing Enter or Delete does that - and ACF brings the editor back through `switchEditors.go()`, which bookmarks the caret and makes WordPress focus and scroll to it once TinyMCE is ready.

= 1.0.7 =
* Fixed AJAX-driven fields inside the canvas never loading past the first page of results. Select2 only requests the next page while its "Loading more results..." row is attached, and checks that against the parent document, so for a list living in the canvas the row never counted as attached.
* Fixed date, date-time and time fields inside the canvas never opening their calendar. jQuery UI walks up from the input looking for a z-index until it meets the parent document, runs past the canvas one instead and throws. The calendar is now also moved into the canvas and kept inside its viewport, closes on a click elsewhere, and gets its stylesheets there.
* Fixed accordions inside the canvas not opening, and everything else ACF delegates from the parent document not reacting to the canvas - legacy `acf.model` / `acf.field.extend()` handlers included. Canvas clicks, mousedowns and changes are now handed on to the parent document's jQuery handlers.
* Fixed Select2 lists, the "Are you sure?" confirmation and the Flexible Content popups staying open on a click elsewhere in the canvas, and Select2 lists in the canvas staying open on a click outside of it.
* Fixed the Flexible Content "add layout" and layout actions popups appearing away from their button. They were created bypassing `acf.newTooltip()`, so they stayed in the parent document; every ACF tooltip is now moved into the canvas and positioned against the canvas viewport, so it also flips below its target near the top edge like it should.
* Fixed WYSIWYG fields in a dragged repeater or Flexible Content row coming out blank. jQuery UI's `sortstart` / `sortstop` never reached ACF, so the row was not unmounted and remounted around the drag.
* Fixed holding Shift not switching the repeater's "add row" icon to "duplicate row" inside the canvas.

= 1.0.4 =
* fix(blocks): prevent TinyMCE selection crash in iframe and bump block apiVersion to 3

= 1.0.3 =
* Fixed the Select2 dropdown of a field inside the canvas opening above the field and drifting away from it. Select2 measures the viewport through the parent window while taking the field's coordinates from the canvas, so it decided there was no room below where there was plenty; it also repositioned on the parent window's scroll only, leaving the list behind when the canvas scrolled.
* Fixed a dropdown left floating over the canvas after the block switched to preview. ACF tears Select2 down from its `remove` handler, which a block form never reaches - it is unmounted, and the list lives outside the node React drops.
* Fixed the block form rendering in the theme's font at the theme's size. ACF's stylesheets expect the wp-admin body font; inside the canvas what they inherit is the editor typography the theme puts on `<body>`, which Select2 - having no font of its own - picked up as well.
* Stopped adding the canvas stylesheets to the editor page itself. `enqueue_block_assets` fires in both places, and on the editor page everything the form needs is already loaded, while the TinyMCE skin added there a second time only got in the way.

= 1.0.2 =
* Fixed post_object, taxonomy, user, page_link and select fields inside the canvas hanging on "Searching..." and never loading a single option. ACF focuses the search box of an open dropdown by looking it up in the parent document; for a dropdown that lives in the canvas the lookup comes back empty, and the exception it raises aborts Select2 before it gets to request the results.
* Added the Select2 stylesheet to the canvas, so such a field no longer renders as a bare drop-down list next to an unstyled search box.

= 1.0.1 =
* Fixed the WYSIWYG field never initialising inside the canvas. TinyMCE and Quicktags look their textarea up by id in the parent document, where it no longer is: Quicktags threw "Cannot read properties of undefined (reading 'buttons')" and TinyMCE silently attached to nothing, leaving the field as a plain textarea.
* Fixed the Visual/Text tabs and the Add Media button of a WYSIWYG field doing nothing - WordPress delegates both from the parent document, which never sees a click made inside the canvas.
* Added the TinyMCE skin and the editor button styles to the canvas, so the editor toolbars are no longer unstyled.

= 1.0.0 =
* Initial release.
