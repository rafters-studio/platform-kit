import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";

/**
 * A software passkey authenticator for tests: a P-256 key that answers better-auth's registration
 * and sign-in challenges the way a browser and platform authenticator would, with "none" attestation.
 */

type Cbor = number | string | Uint8Array | Map<number | string, Cbor>;

// The small slice of CBOR (RFC 8949) WebAuthn needs: unsigned and negative ints, byte and text strings, maps.
function cbor(value: Cbor): Buffer {
  const head = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    const out = Buffer.alloc(3);
    out[0] = (major << 5) | 25;
    out.writeUInt16BE(length, 1);
    return out;
  };
  if (typeof value === "number") return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === "string") {
    const bytes = Buffer.from(value, "utf8");
    return Buffer.concat([head(3, bytes.length), bytes]);
  }
  if (value instanceof Uint8Array) return Buffer.concat([head(2, value.length), value]);
  const parts = [head(5, value.size)];
  for (const [key, item] of value) parts.push(cbor(key), cbor(item));
  return Buffer.concat(parts);
}

const b64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");
const sha256 = (bytes: Uint8Array | string): Buffer => createHash("sha256").update(bytes).digest();

function clientData(
  type: "webauthn.create" | "webauthn.get",
  challenge: string,
  origin: string,
): Buffer {
  return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
}

// Flags: user present (0x01) and user verified (0x04); 0x40 marks attested credential data.
const UP_UV = 0x05;
const AT = 0x40;

export class SoftwarePasskey {
  private readonly privateKey: KeyObject;
  private readonly publicKey: KeyObject;
  readonly credentialId = randomBytes(32);
  private signCount = 0;

  constructor(
    private readonly rpId: string,
    private readonly origin: string,
  ) {
    const pair = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey;
  }

  private authData(flags: number, attested?: Buffer): Buffer {
    const count = Buffer.alloc(4);
    count.writeUInt32BE(this.signCount);
    return Buffer.concat([
      sha256(this.rpId),
      Buffer.from([flags]),
      count,
      ...(attested ? [attested] : []),
    ]);
  }

  /** The JSON a browser posts to verify-registration, answering the given challenge. */
  register(challenge: string): Record<string, unknown> {
    const jwk = this.publicKey.export({ format: "jwk" });
    const coseKey = new Map<number, Cbor>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x ?? "", "base64url")],
      [-3, Buffer.from(jwk.y ?? "", "base64url")],
    ]);
    const idLength = Buffer.alloc(2);
    idLength.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, cbor(coseKey)]);
    const attestationObject = cbor(
      new Map<string, Cbor>([
        ["fmt", "none"],
        ["attStmt", new Map()],
        ["authData", this.authData(UP_UV | AT, attested)],
      ]),
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(clientData("webauthn.create", challenge, this.origin)),
        attestationObject: b64url(attestationObject),
        transports: ["internal"],
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }

  /** The JSON a browser posts to verify-authentication, signing the given challenge. */
  authenticate(challenge: string): Record<string, unknown> {
    this.signCount += 1;
    const authenticatorData = this.authData(UP_UV);
    const data = clientData("webauthn.get", challenge, this.origin);
    const signature = sign(
      "sha256",
      Buffer.concat([authenticatorData, sha256(data)]),
      this.privateKey,
    );
    return {
      id: b64url(this.credentialId),
      rawId: b64url(this.credentialId),
      type: "public-key",
      response: {
        clientDataJSON: b64url(data),
        authenticatorData: b64url(authenticatorData),
        signature: b64url(signature),
      },
      clientExtensionResults: {},
      authenticatorAttachment: "platform",
    };
  }
}
