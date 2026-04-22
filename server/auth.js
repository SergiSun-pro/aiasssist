import crypto from 'node:crypto'

const SECRET = process.env.JWT_SECRET || 'aiasssist-default-secret-change-me'
const TOKEN_EXPIRY_MS = 30 * 24 * 60 * 60 * 1000 // 30 дней

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':')
  const hashVerify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(hashVerify, 'hex'))
}

export function createToken(user) {
  const payload = { id: user.id, username: user.username, role: user.role, exp: Date.now() + TOKEN_EXPIRY_MS }
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
  return `${payloadB64}.${sig}`
}

export function verifyToken(token) {
  try {
    const [payloadB64, sig] = (token || '').split('.')
    if (!payloadB64 || !sig) return null
    const expectedSig = crypto.createHmac('sha256', SECRET).update(payloadB64).digest('base64url')
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    if (payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
