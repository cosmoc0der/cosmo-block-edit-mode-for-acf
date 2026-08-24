# Block Edit Mode for ACF

Brings back the **Switch to Edit / Switch to Preview** toggle and the field form
*inside* ACF blocks, instead of only in the sidebar.

Requires **ACF PRO**. Does nothing without it.

## The problem

The post editor canvas is now always rendered inside an iframe — `BlockCanvas`
gets `shouldIframe: true` unconditionally, without the old `apiVersion` check.

ACF's blocks bundle (`assets/build/js/pro/acf-pro-blocks.min.js`) detects that:

```js
function I() {
    return document.querySelectorAll( 'iframe[name="editor-canvas"]' ).length > 0;
}
```

Wherever it returns true, `setup()` pins the block to `mode = "preview"` and
`render()` hides the toolbar toggle (`supports.mode` → `false`) and moves the
field form into `InspectorControls` — the sidebar. Previously the check never
passed; now it always does. ACF exposes neither a filter nor a setting for it.

## What the plugin does

1. **Patches the bundle at runtime.** A copy of `acf-pro-blocks.min.js` with
   `I()` forced to `return false` is written to
   `wp-content/uploads/block-edit-mode-for-acf/`, and the `acf-blocks` handle's
   `src` is swapped via `script_loader_src`. The file name is keyed to the ACF
   version, size and mtime, so it rebuilds itself after an ACF update. If the
   pattern is no longer found, the original is served untouched and an admin
   notice is shown. ACF's own files are never modified.
2. **Styles the form inside the iframe.** The canvas iframe is assembled by
   `_wp_get_iframed_editor_assets()` in a "frontend" context, so it has no
   `common.css` / `forms.css` from wp-admin. `assets/iframe.css` plus
   `acf-pro-input` and `buttons` are enqueued through `enqueue_block_assets`.
3. **Fixes cross-document glitches** (`assets/editor.js`): the `wp-core-ui`
   class on the canvas `<html>` (button styles key off it), `dropdownParent`
   for select2, and relocating tooltips — the repeater row delete confirmation —
   into the iframe document.

## Install

Upload via **Plugins → Add New → Upload Plugin**, or drop the folder into
`wp-content/plugins/`, then activate.

## Disable without deactivating

```php
add_filter( 'cosmo/block_edit_mode_for_acf/enabled', '__return_false' );
```

## Uninstall

Deleting the plugin removes the generated cache folder in `wp-content/uploads/`
and its transient. Deactivating alone leaves them in place.

## Worth re-testing after ACF or WordPress updates

A block containing a repeater, a select / post_object and an image — the fields
that pull in select2 positioning, the media modal and tooltips.

## License

GPL-2.0-or-later. Not affiliated with WP Engine or the Advanced Custom Fields
team.
