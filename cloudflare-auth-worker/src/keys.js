// Public JWK for token verification
export const PUBLIC_JWK = {
  "kty": "RSA",
  "n": "y6wBv3Fl5AOstaeXu3ZniNTL8iOh47_RTEcKN1UcmJeADENNRRV48tGqk7zty_9z7d3GNc2FjZms24isgiD3SbjmtVfOhZEYSoNGEzCX1SwsU_jSflaqajym5bl9W-4y00PRwMsYTxDp3jxOvNUCJGEXlVV90ztBf3wGt8psEaTF7JKJfYJsQ9k1ONf9kimtsCP4OU1w11exCAK8X_zO7dmT3EpqkkkcpGYSxOZz2v0Au5AsbvhgpyJdgVGMs34zm7EBbcnlyOe6tEmGtEy_OrxVDAeunlP_Y5YE_gFCdYcq7OmEeh814-Mfh6_07WRarvmD5ZPgkh8CW9S0BGnSKw",
  "e": "AQAB",
  "kid": "dc-auth-key-1",
  "use": "sig",
  "alg": "RS256"
};

/**
 * Load private key dynamically from Cloudflare Worker environment secret (AUTH_PRIVATE_JWK)
 * or generate on-the-fly if not provided.
 */
export async function getPrivateKeyJwk(env) {
  if (env?.AUTH_PRIVATE_JWK) {
    try {
      return typeof env.AUTH_PRIVATE_JWK === 'string' ? JSON.parse(env.AUTH_PRIVATE_JWK) : env.AUTH_PRIVATE_JWK;
    } catch (_) {}
  }
  return null;
}
