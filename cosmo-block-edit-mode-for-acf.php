<?php
/**
 * Plugin Name:       Cosmo Block Edit Mode for ACF
 * Plugin URI:        https://github.com/cosmoc0der/block-edit-mode-for-acf
 * Description:       Restores the "Switch to Edit / Switch to Preview" toggle and the field form inside ACF blocks themselves, which ACF disables whenever the editor canvas is rendered in an iframe.
 * Version:           1.0.3
 * Requires at least: 6.8
 * Requires PHP:      7.4
 * Author:            Bakhodir Sharipov
 * Author URI:        https://github.com/cosmoc0der
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       cosmo-block-edit-mode-for-acf
 *
 * @package Cosmo_Block_Edit_Mode_For_ACF
 */
namespace cosmo\Block_Edit_Mode_For_ACF;

defined( 'ABSPATH' ) || exit;

const VERSION      = '1.0.3';
const CACHE_DIR    = 'cosmo-block-edit-mode-for-acf';
const FAILURE_FLAG = 'cosmo_block_edit_mode_for_acf_patch_failed';

add_filter( 'script_loader_src', __NAMESPACE__ . '\filter_block_script_src', 10, 2 );
add_action( 'enqueue_block_editor_assets', __NAMESPACE__ . '\enqueue_editor_assets', 20 );
add_action( 'enqueue_block_assets', __NAMESPACE__ . '\enqueue_canvas_assets' );
add_action( 'admin_notices', __NAMESPACE__ . '\render_failure_notice' );

/**
 * Whether the patch is enabled.
 *
 * Disable completely:
 *     add_filter( 'cosmo/block_edit_mode_for_acf/enabled', '__return_false' );
 *
 * @return bool
 */
function is_enabled(): bool {
	return (bool) apply_filters( 'cosmo/block_edit_mode_for_acf/enabled', true );
}

/**
 * URL of a file in this plugin's assets folder.
 *
 * @param string $file File name relative to assets/.
 * @return string
 */
function asset_url( string $file ): string {
	return plugins_url( 'assets/' . $file, __FILE__ );
}

/**
 * Whether ACF serves its unminified builds.
 *
 * Both constant names are checked: ACF uses ACF_DEVELOPMENT_MODE, its
 * WordPress.org fork (Secure Custom Fields) uses SCF_DEVELOPMENT_MODE.
 *
 * @return bool
 */
function is_development_mode(): bool {
	if ( defined( 'ACF_DEVELOPMENT_MODE' ) && ACF_DEVELOPMENT_MODE ) {
		return true;
	}
	
	return defined( 'SCF_DEVELOPMENT_MODE' ) && SCF_DEVELOPMENT_MODE;
}

/**
 * Replaces the original acf-pro-blocks.min.js with a patched copy.
 *
 * @param string $src    The script URL.
 * @param string $handle The script handle.
 * @return string
 */
function filter_block_script_src( $src, $handle ) {
	if ( 'acf-blocks' !== $handle || ! is_admin() || ! is_enabled() ) {
		return $src;
	}
	
	$patched = get_patched_script_url();
	
	return $patched ? $patched : $src;
}

/**
 * A regex that locates the "editor inside iframe" check within the ACF build.
 *
 * In the source code it looks like this:
 *     function isBlockEditorIframed() {
 *         return document.querySelectorAll( 'iframe[name="editor-canvas"]' ).length > 0;
 *     }
 *
 * This is precisely what makes ACF force the block mode to "preview" and hide the
 * mode-switching button in the toolbar (see the BlockEdit class in acf-pro-blocks).
 *
 * @return string
 */
function search_pattern(): string {
	return '~function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(\s*\)\s*\{\s*return\s+document\.querySelectorAll\(\s*'
	       . '([\'"])iframe\[name=\\\\?"editor-canvas\\\\?"\]\2\s*\)\.length\s*>\s*0\s*;?\s*\}~';
}

/**
 * Returns the URL of the patched copy of the ACF blocks script, creating it if necessary.
 *
 * The copy lives in the uploads directory and its file name is derived from the ACF
 * version plus the source file's size and modification time, so it regenerates by
 * itself after an ACF update.
 *
 * @return string|false
 */
function get_patched_script_url() {
	static $url = null;
	
	if ( null !== $url ) {
		return $url;
	}
	
	$url = false;
	
	if ( ! defined( 'ACF_VERSION' ) || ! function_exists( 'acf_get_path' ) ) {
		return $url;
	}
	
	$min    = is_development_mode() ? '' : '.min';
	$source = acf_get_path( "assets/build/js/pro/acf-pro-blocks{$min}.js" );
	
	if ( ! is_readable( $source ) ) {
		return $url;
	}
	
	$uploads = wp_upload_dir();
	
	if ( ! empty( $uploads['error'] ) ) {
		return $url;
	}
	
	$key      = substr( md5( ACF_VERSION . '|' . VERSION . '|' . filemtime( $source ) . '|' . filesize( $source ) ), 0, 12 );
	$filename = "acf-pro-blocks-{$key}{$min}.js";
	$dir      = untrailingslashit( $uploads['basedir'] ) . '/' . CACHE_DIR;
	$path     = $dir . '/' . $filename;
	$public   = trailingslashit( $uploads['baseurl'] ) . CACHE_DIR . '/' . $filename;
	
	if ( file_exists( $path ) ) {
		$url = $public;
		
		return $url;
	}
	
	$filesystem = filesystem();
	
	if ( ! $filesystem ) {
		return $url;
	}
	
	$source_js  = $filesystem->get_contents( $source );
	$patched_js = preg_replace( search_pattern(), 'function $1(){return false}', (string) $source_js, -1, $replaced );
	
	// The check was not found - most likely ACF rewrote this part of the build.
	// Silently fall back to the original and warn the administrator in wp-admin.
	if ( empty( $replaced ) || null === $patched_js ) {
		set_transient( FAILURE_FLAG, ACF_VERSION, WEEK_IN_SECONDS );
		
		return $url;
	}
	
	if ( ! write_atomic( $filesystem, $dir, $path, $patched_js ) ) {
		set_transient( FAILURE_FLAG, ACF_VERSION, WEEK_IN_SECONDS );
		
		return $url;
	}
	
	purge_stale_copies( $filesystem, $dir, $filename );
	delete_transient( FAILURE_FLAG );
	
	$url = $public;
	
	return $url;
}

/**
 * Initialised WP_Filesystem instance, or false when direct access is unavailable.
 *
 * Only the "direct" method is used: any other one would prompt the user for FTP
 * credentials, which is not acceptable in the middle of rendering the editor.
 *
 * @return \WP_Filesystem_Base|false
 */
function filesystem() {
	global $wp_filesystem;
	
	require_once ABSPATH . 'wp-admin/includes/file.php';
	
	if ( 'direct' !== get_filesystem_method() ) {
		return false;
	}
	
	if ( ! WP_Filesystem() || ! $wp_filesystem ) {
		return false;
	}
	
	return $wp_filesystem;
}

/**
 * Writes the patched build through a temporary file, so that a concurrent request
 * can never pick up a half-written script.
 *
 * @param \WP_Filesystem_Base $filesystem Filesystem instance.
 * @param string              $dir        Target directory.
 * @param string              $path       Target file path.
 * @param string              $contents   File contents.
 * @return bool
 */
function write_atomic( $filesystem, string $dir, string $path, string $contents ): bool {
	if ( ! $filesystem->is_dir( $dir ) && ! wp_mkdir_p( $dir ) ) {
		return false;
	}
	
	$tmp = $path . '.' . wp_generate_password( 8, false ) . '.tmp';
	
	if ( ! $filesystem->put_contents( $tmp, $contents, FS_CHMOD_FILE ) ) {
		return false;
	}
	
	if ( ! $filesystem->move( $tmp, $path, true ) ) {
		$filesystem->delete( $tmp );
		
		return false;
	}
	
	return true;
}

/**
 * Removes copies left over from previous ACF versions.
 *
 * @param \WP_Filesystem_Base $filesystem Filesystem instance.
 * @param string              $dir        Cache directory.
 * @param string              $keep       File name that must be preserved.
 * @return void
 */
function purge_stale_copies( $filesystem, string $dir, string $keep ) {
	$listing = $filesystem->dirlist( $dir );
	
	if ( ! is_array( $listing ) ) {
		return;
	}
	
	foreach ( $listing as $name => $item ) {
		if ( $name === $keep || 'f' !== $item['type'] ) {
			continue;
		}
		
		if ( 1 === preg_match( '~^acf-pro-blocks-[a-f0-9]{12}(\.min)?\.js(\.[A-Za-z0-9]+\.tmp)?$~', $name ) ) {
			$filesystem->delete( $dir . '/' . $name );
		}
	}
}

/**
 * Companion script inside the editor itself (the parent document).
 *
 * @return void
 */
function enqueue_editor_assets() {
	if ( ! is_enabled() || ! wp_script_is( 'acf-blocks', 'enqueued' ) ) {
		return;
	}
	
	wp_enqueue_script(
		'cosmo-block-edit-mode-for-acf',
		asset_url( 'editor.js' ),
		array( 'acf-blocks' ),
		VERSION,
		true
	);
}

/**
 * Whether the assets currently being collected are the canvas iframe's own.
 *
 * `enqueue_block_assets` fires on the editor screen as well as inside
 * _wp_get_iframed_editor_assets(), and only the latter is ours: everything the
 * form needs is already on the editor page, whereas an admin stylesheet added
 * there a second time (the TinyMCE skin in particular) only gets in the way.
 * The iframe run is the one core marks by forcing the block editor assets off.
 *
 * @return bool
 */
function is_canvas_context(): bool {
	if ( ! is_admin() || ! function_exists( 'wp_should_load_block_editor_scripts_and_styles' ) ) {
		return false;
	}
	
	return ! wp_should_load_block_editor_scripts_and_styles();
}

/**
 * ACF field styles inside the canvas iframe.
 *
 * WordPress assembles the iframe contents separately (_wp_get_iframed_editor_assets),
 * running enqueue_block_assets in a "frontend" context; as a result the ACF admin
 * styles are left out and the block form would render unstyled.
 *
 * @return void
 */
function enqueue_canvas_assets() {
	if ( ! is_enabled() || ! is_canvas_context() ) {
		return;
	}
	
	if ( ! wp_style_is( 'acf-input', 'registered' ) ) {
		return;
	}
	
	// .acf-button and other ACF controls rely on the wp-admin button styles.
	wp_enqueue_style( 'buttons' );
	
	enqueue_editor_styles();
	
	$acf_style = wp_style_is( 'acf-pro-input', 'registered' ) ? 'acf-pro-input' : 'acf-input';
	wp_enqueue_style( $acf_style );
	
	$deps    = array( $acf_style );
	$select2 = enqueue_select2_style();
	
	if ( $select2 ) {
		$deps[] = $select2;
	}
	
	wp_enqueue_style(
		'cosmo-block-edit-mode-for-acf',
		asset_url( 'iframe.css' ),
		$deps,
		VERSION
	);
}

/**
 * The Select2 stylesheet, used by select, post_object, taxonomy, user and page_link.
 *
 * ACF enqueues it from the select field's input_admin_enqueue_scripts(), which runs
 * on admin_enqueue_scripts - long after WordPress has collected the canvas assets
 * (get_block_editor_settings() is called before admin-header.php is loaded). The
 * handle is therefore not even registered yet at this point, so the URL is resolved
 * exactly the way ACF resolves it.
 *
 * Without the stylesheet the original <select> is never hidden and the Select2
 * markup next to it stays unstyled, which is what a post_object field inside the
 * canvas looked like.
 *
 * @return string Style handle, or an empty string when Select2 is not in play.
 */
function enqueue_select2_style(): string {
	if ( wp_style_is( 'select2', 'registered' ) ) {
		wp_enqueue_style( 'select2' );
		
		return 'select2';
	}
	
	if ( ! function_exists( 'acf_get_setting' ) || ! function_exists( 'acf_get_url' ) ) {
		return '';
	}
	
	if ( ! acf_get_setting( 'enqueue_select2' ) ) {
		return '';
	}
	
	global $wp_scripts;
	
	$major = (int) acf_get_setting( 'select2_version' );
	
	// A third-party Select2 already on the page decides which version ACF talks to.
	if ( isset( $wp_scripts->registered['select2'] ) ) {
		$major = (int) $wp_scripts->registered['select2']->ver;
	}
	
	if ( 3 === $major ) {
		$src     = acf_get_url( 'assets/inc/select2/3/select2.css' );
		$version = '3.5.2';
	} else {
		$min     = is_development_mode() ? '' : '.min';
		$src     = acf_get_url( "assets/inc/select2/4/select2{$min}.css" );
		$version = '4.0.13';
	}
	
	wp_enqueue_style( 'select2', $src, array(), $version );
	
	return 'select2';
}

/**
 * TinyMCE and Quicktags styles for the WYSIWYG field.
 *
 * Both toolbars are built by scripts running in the parent document, so their
 * stylesheets end up in the parent <head> while the markup they produce is
 * inserted into the canvas. TinyMCE loads its skin itself, which is why there
 * is no core handle for it and we register our own.
 *
 * @return void
 */
function enqueue_editor_styles() {
	if ( wp_style_is( 'editor-buttons', 'registered' ) ) {
		wp_enqueue_style( 'editor-buttons' );
	}
	
	$suffix = defined( 'SCRIPT_DEBUG' ) && SCRIPT_DEBUG ? '' : '.min';
	
	/**
	 * Filters the URL of the TinyMCE skin loaded inside the canvas.
	 *
	 * Only needed when the skin has been swapped through tiny_mce_before_init.
	 *
	 * @param string $url Stylesheet URL.
	 */
	$skin = apply_filters(
		'cosmo/block_edit_mode_for_acf/tinymce_skin_url',
		includes_url( "js/tinymce/skins/lightgray/skin{$suffix}.css" )
	);
	
	if ( ! $skin ) {
		return;
	}
	
	wp_enqueue_style( 'cosmo-block-edit-mode-for-acf-tinymce', $skin, array(), get_bloginfo( 'version' ) );
}

/**
 * Notifies the administrator when the patch could not be applied after an ACF update.
 *
 * @return void
 */
function render_failure_notice() {
	if ( ! is_enabled() || ! current_user_can( 'activate_plugins' ) ) {
		return;
	}
	
	$version = get_transient( FAILURE_FLAG );
	
	if ( ! $version ) {
		return;
	}
	
	printf(
		'<div class="notice notice-warning"><p><strong>%1$s</strong> %2$s</p></div>',
		esc_html__( 'Cosmo Block Edit Mode for ACF:', 'cosmo-block-edit-mode-for-acf' ),
		esc_html(
			sprintf(
			/* translators: %s: ACF version number. */
				__( 'Could not patch the ACF blocks bundle (version %s) - it looks like ACF has changed that part of its code. Blocks will keep opening in preview mode with the fields in the sidebar until the plugin is updated.', 'cosmo-block-edit-mode-for-acf' ),
				$version
			)
		)
	);
}
