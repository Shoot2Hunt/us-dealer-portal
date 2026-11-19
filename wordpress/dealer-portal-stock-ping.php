<?php
/**
 * Plugin Name: Dealer Portal Stock Ping
 * Description: Tells the dealer portal the moment stock changes, including variations and order-driven changes that WooCommerce webhooks can miss.
 * Version: 1.0.0
 *
 * Install: copy to wp-content/mu-plugins/ on each store, then add to wp-config.php:
 *   define('DEALER_PORTAL_URL', 'https://dealers.example.com/api/webhooks/woo/unknown-suppressors');
 *   define('DEALER_PORTAL_SECRET', 'same value as WOO_<STORE>_WEBHOOK_SECRET in the portal');
 */

if (!defined('ABSPATH')) exit;

function dealer_portal_ping($product) {
    if (!defined('DEALER_PORTAL_URL') || !defined('DEALER_PORTAL_SECRET')) return;
    if (!$product instanceof WC_Product) $product = wc_get_product($product);
    if (!$product) return;

    $body = wp_json_encode([
        'id'     => $product->get_id(),
        'parent' => $product->get_parent_id(),
    ]);

    wp_remote_post(DEALER_PORTAL_URL, [
        'blocking' => false,
        'timeout'  => 3,
        'headers'  => [
            'Content-Type'   => 'application/json',
            'X-DP-Signature' => base64_encode(hash_hmac('sha256', $body, DEALER_PORTAL_SECRET, true)),
        ],
        'body'     => $body,
    ]);
}

add_action('woocommerce_product_set_stock', 'dealer_portal_ping');
add_action('woocommerce_variation_set_stock', 'dealer_portal_ping');
add_action('woocommerce_product_set_stock_status', function ($product_id) { dealer_portal_ping($product_id); });
add_action('woocommerce_variation_set_stock_status', function ($variation_id) { dealer_portal_ping($variation_id); });
