const crypto = require('crypto');

function getVaultKey() {
    const secretMaterial = process.env.ACCOUNT_VAULT_KEY || process.env.JWT_SECRET;
    if (!secretMaterial) {
        throw new Error('ACCOUNT_VAULT_KEY or JWT_SECRET must be set for account vault encryption');
    }

    return crypto.createHash('sha256').update(String(secretMaterial)).digest();
}

function encryptAccountNumber(accountNumber) {
    const plaintext = String(accountNumber || '').trim();
    if (!plaintext) {
        throw new Error('Account number is required');
    }

    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', getVaultKey(), iv);
    const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptAccountNumber(payload) {
    const parts = String(payload || '').split(':');
    if (parts.length !== 3) {
        throw new Error('Invalid encrypted account payload');
    }

    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const encrypted = Buffer.from(parts[2], 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', getVaultKey(), iv);
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return decrypted.toString('utf8');
}

module.exports = {
    encryptAccountNumber,
    decryptAccountNumber
};
