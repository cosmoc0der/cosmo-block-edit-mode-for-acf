# Cosmo Block Edit Mode for ACF

Brings back the **Switch to Edit / Switch to Preview** toggle and the field form
*inside* ACF blocks, instead of only in the sidebar.

Requires **ACF PRO**. Does nothing without it.

Independent, unofficial plugin. "ACF" and "Advanced Custom Fields" are trademarks
of WP Engine; this project is not affiliated with, endorsed by, or sponsored by
WP Engine or the Advanced Custom Fields team.

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
   `wp-content/uploads/cosmo-block-edit-mode-for-acf/`, and the `acf-blocks` handle's
   `src` is swapped via `script_loader_src`. The file name is keyed to the ACF
   version, size and mtime, so it rebuilds itself after an ACF update. If the
   pattern is no longer found, the original is served untouched and an admin
   notice is shown. ACF's own files are never modified.
2. **Styles the form inside the iframe.** The canvas iframe is assembled by
   `_wp_get_iframed_editor_assets()` in a "frontend" context, so it has no
   `common.css` / `forms.css` from wp-admin. `assets/iframe.css` plus
   `acf-pro-input`, `buttons`, `editor-buttons`, select2 and the TinyMCE skin
   are enqueued through `enqueue_block_assets`. ACF enqueues select2 itself only
   on `admin_enqueue_scripts`, which runs after WordPress has already collected
   the canvas assets, so its URL is resolved the same way ACF resolves it.
3. **Fixes cross-document glitches** (`assets/editor.js`): the `wp-core-ui`
   class on the canvas `<html>` (button styles key off it), `dropdownParent`
   for select2, and relocating tooltips — the repeater row delete confirmation —
   into the iframe document.
4. **Keeps select2 fields loading** (`assets/editor.js`). On `select2:open` ACF
   focuses the search box via
   `$( '.select2-container--open .select2-search__field' ).get( -1 ).focus()`,
   a lookup in the parent document. The dropdown of a canvas field is not there,
   so the lookup returns `undefined` and the call throws — inside select2's own
   `query` handler, before it reaches the data adapter. The request is never
   made: post_object, taxonomy, user and page_link hang on *Searching...*
   forever, a plain select never receives its options. The plugin binds its own
   handler from the `select2_args` filter, which runs just before ACF binds
   its own, and stops the event there.
5. **Revives the WYSIWYG field** (`assets/editor.js`). TinyMCE and Quicktags run
   in the parent document and resolve the editor by id there, so a textarea in
   the canvas is invisible to them: `quicktags()` is a constructor, so its
   `return false` still hands back an object — one without `settings` — and ACF's
   `buildQuicktags()` dies on `settings.buttons`, while `tinymce.init()` resolves
   its `selector` against the wrong document and initialises nothing. The plugin
   lets `document.getElementById()` fall back to the canvas documents, passes
   TinyMCE the textarea as `target` instead of a selector, and re-delegates the
   Visual/Text tabs and the Add Media button — both bound to the parent
   `document` by core — onto the canvas document.

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

A block containing a repeater, a select / post_object, an image and a WYSIWYG
(with *Delay initialization* on) — the fields that pull in select2 positioning,
the media modal, tooltips and TinyMCE.

## License

GPL-2.0-or-later. Not affiliated with WP Engine or the Advanced Custom Fields
team.
