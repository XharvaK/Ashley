export type SecretHit = { hit: true; kind: string };
export type SecretMiss = { hit: false };

export declare const CREDENTIAL_OMITTED_PLACEHOLDER: "[credential omitted]";
export declare function detectCredentialShape(text: string): SecretHit | SecretMiss;
