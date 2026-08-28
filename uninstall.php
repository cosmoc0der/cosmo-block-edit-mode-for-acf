<?php
/**
 * Uninstall routine: drops the generated script cache and the failure flag.
 *
 * @package Cosmo_Block_Edit_Mode_For_ACF
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_transient( 'cosmo_block_edit_mode_for_acf_patch_failed' );

$uploads = wp_upload_dir();

if ( ! empty( $uploads['error'] ) || empty( $uploads['basedir'] ) ) {
	return;
}

$cache_dir = untrailingslashit( $uploads['basedir'] ) . '/cosmo-block-edit-mode-for-acf';

if ( ! is_dir( $cache_dir ) ) {
	return;
}

require_once ABSPATH . 'wp-admin/includes/file.php';

if ( 'direct' !== get_filesystem_method() || ! WP_Filesystem() ) {
	return;
}

global $wp_filesystem;

if ( $wp_filesystem ) {
	$wp_filesystem->delete( $cache_dir, true );
}
