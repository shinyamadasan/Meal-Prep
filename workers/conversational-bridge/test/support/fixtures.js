// Test-only fixtures. FAKE_PRIVATE_KEY is a throwaway RSA-2048 keypair's private half, generated
// once with `node -e "require('crypto').generateKeyPairSync(...)"` purely so auth.js's real
// Web Crypto JWT-signing path has something to sign in tests. It has never been used for
// anything else and is not a Google/Firebase credential of any kind.
export const FAKE_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCn7cJW+o5a3bsG
mt52cS73gVwoPgLqxWeUGUy995BZuvGOjSowYvy9cJZ1x+6kmp21X/kMor5d6BZ7
Za7DBmBkseyUcIXaorLu2TiDYwh3ttDC9xS2bwEDSdpHtem2D4DAlA/Rv08XpS0+
Hz5CJCNMg6P+pnzMDq951M6/0qCIRjarAkbnEvQA/0W5ohcril8fKSS1kykCWFzW
0g6BN38rUFtMIzbtQBXdHZQaGK6S8ZIIEmSBcQGu2MJuUOoy3+XnA6kE+NTR4vIG
tmvK5U85v5zLcox++1ZEvcaQ7g5jo315CgMVi4jEJNNqVBHenQsQ/02zYtsxM4Vn
elDw2YsjAgMBAAECggEACZr7Sh0G1i0SAkIK24eEgjpvWmCXAMrN2UDL4knY2JPC
4WkzB+rW6MHEjsl4MwjNCzo0IAQ8aK6v1TBvG09autJv5TBn16Zayc1kWCTqr75Q
mUunbvqmei5X7VDQeiN6NTRtkI0lfwVpsxX3v7Ia0B5E289gxWNJp5RZRyD1zGrv
+aTsLaacOhZvf6pFTYjhWL+twy7vcswAwtnQCCIL/Ci/WxmO/odhaGJHjzCy4Y62
0/z/W7D5UA0juC2LzjZ/RRjS7ttShMidrkmb8nh7OJJSdD/BlfkS9ciaL4zhDxGx
NB/9dpSKsb8Y6ucCKTwl0O5luTwSOrkFJ2sdg+bOIQKBgQDbzqY2oLjmFp/eUpSh
ZqbjfT2gsrs9buvVPXtIgaygWPfZ1Rfh3UHN2TDu0oL4jiP54M0TtIIlkEoRs+pK
zPdjKLFhZeZzH0vB1kwt8PV0WnIGFgk3qE5Yv9gM9jfx9348P/wn7FdnDnIJSR3z
jP1FVfVtuoQmj2innt8rBcIZywKBgQDDlFHVAS/+2AaEcSzmGSWqO3WE/9YlpDco
Bj8hSL63ymtjG9YPFL+A5R+vg5J5RJGncriuT+R04m4zEuka4nNEiQxNYS7JrLsr
KjnrzkCv3j3bdh04lanJA1tHUgXJqEgE3bxj7nkcC3DGcSmSQp/h+ZQYuWs9S9e2
pU3TFIuJCQKBgQCbDli0Goa0UOtvssOEY9yAh72smch52sBkSZ2pFUjISFp3ANp7
C1C7PGZHYprfaa25PLqOFvzkMLf/avJw18v/2BnhAjghp8cSMvDES8Fq1c6vumXA
LGswMgzff+URPKyBJgXjx9YULd2F7V1CjIexnKSoRjWo2etSq0D0oXg+JwKBgBr5
hvvY6RS+GNAFiArIZyB+iOvqGVAhwRW9HtHpZZyVx4/o0/JKi0ssztz3Sal+IpS0
xvILxNe2LzrOHeZ+WyWVvWOixsA8GaiPb2Otk9Bt15xAQzF9uugllV5V2sSAeEZr
isNBreSHU2ubSf+JPuH8+Ucbs8XFgyAG1qAJUmF5AoGABlDu88bFr9GPZ0ssfACG
nHf5s5PjqRaJFs/bEYFxaZiixNMeM9lKArNJKeKIR44MicyydeeTQtH5lPLO6j4L
u8dDcxO4WF+E/xBeTcI21XnjZ0h67RdmCf9DEsgrT5fL5oLFhA07Vjz0CyQ81H6X
4MqOV3382fFcvJJ/iUA1MS8=
-----END PRIVATE KEY-----`;

export const FAKE_SERVICE_ACCOUNT_JSON = JSON.stringify({
  type: 'service_account',
  project_id: 'meal-prep-test',
  client_email: 'bridge-test@meal-prep-test.iam.gserviceaccount.com',
  private_key: FAKE_PRIVATE_KEY
});

export function testEnv(overrides = {}) {
  return Object.assign({
    BRIDGE_API_TOKEN: 'test-bridge-token',
    FIREBASE_SERVICE_ACCOUNT_JSON: FAKE_SERVICE_ACCOUNT_JSON,
    FIRESTORE_PROJECT_ID: 'meal-prep-test',
    TARGET_UID: 'test-uid-1',
    ACCESS_TEAM_DOMAIN: 'https://test.cloudflareaccess.com',
    ACCESS_POLICY_AUD: 'test-access-policy-audience',
    MCP_AUTHORIZED_OWNER_SUBJECT: 'test-owner-subject'
  }, overrides);
}

export function request(path, { method = 'GET', token = 'test-bridge-token', body, contentType = 'application/json', headers = {} } = {}) {
  const finalHeaders = Object.assign({}, headers);
  if (token !== null) finalHeaders.Authorization = 'Bearer ' + token;
  if (body !== undefined && contentType !== null) finalHeaders['Content-Type'] = contentType;
  return new Request('https://worker.test' + path, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body))
  });
}
