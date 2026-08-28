=== Cosmo Block Edit Mode for ACF ===
Contributors: bakhods
Tags: block editor, custom fields, blocks, inline editing, editor
Requires at least: 6.8
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.3
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

= 1.0.2 =
* Fixed post_object, taxonomy, user, page_link and select fields inside the canvas hanging on "Searching..." and never loading a single option. ACF focuses the search box of an open dropdown by looking it up in the parent document; for a dropdown that lives in the canvas the lookup comes back empty, and the exception it raises aborts Select2 before it gets to request the results.
* Added the Select2 stylesheet to the canvas, so such a field no longer renders as a bare drop-down list next to an unstyled search box.

= 1.0.1 =
* Fixed the WYSIWYG field never initialising inside the canvas. TinyMCE and Quicktags look their textarea up by id in the parent document, where it no longer is: Quicktags threw "Cannot read properties of undefined (reading 'buttons')" and TinyMCE silently attached to nothing, leaving the field as a plain textarea.
* Fixed the Visual/Text tabs and the Add Media button of a WYSIWYG field doing nothing - WordPress delegates both from the parent document, which never sees a click made inside the canvas.
* Added the TinyMCE skin and the editor button styles to the canvas, so the editor toolbars are no longer unstyled.

= 1.0.0 =
* Initial release.
