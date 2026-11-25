import crypto from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import type net from 'node:net'
import path from 'node:path'
import tls from 'node:tls'
import { DATA_DIR } from './paths.ts'

export interface LocalTlsBundle {
  caCertPem: string
  caCertPath: string
  leafCertPem: string
  leafKeyPem: string
  secureContext: tls.SecureContext
}

function derLen(len: number): Buffer {
  if (len < 128) return Buffer.from([len])
  const hex = len.toString(16).padStart(len > 255 ? 4 : 2, '0')
  const bytes = Buffer.from(hex, 'hex')
  return Buffer.concat([Buffer.from([0x80 | bytes.length]), bytes])
}

function derTlv(tag: number, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from([tag]), derLen(content.length), content])
}

function derSeq(...items: Buffer[]): Buffer {
  return derTlv(0x30, Buffer.concat(items))
}

function derSet(...items: Buffer[]): Buffer {
  return derTlv(0x31, Buffer.concat(items))
}

function derOid(bytes: number[]): Buffer {
  return derTlv(0x06, Buffer.from(bytes))
}

function derUtf8(str: string): Buffer {
  return derTlv(0x0c, Buffer.from(str, 'utf8'))
}

function derUtcTime(d: Date): Buffer {
  const s = d.toISOString().replace(/[-:T]/g, '').slice(2, 14) + 'Z'
  return derTlv(0x17, Buffer.from(s, 'ascii'))
}

function derInt(buf: Buffer | number): Buffer {
  let b = Buffer.isBuffer(buf) ? buf : Buffer.from([buf])
  if (b[0]! & 0x80) b = Buffer.concat([Buffer.from([0x00]), b])
  return derTlv(0x02, b)
}

function derBitString(buf: Buffer, unusedBits = 0): Buffer {
  return derTlv(0x03, Buffer.concat([Buffer.from([unusedBits]), buf]))
}

function derOctetString(buf: Buffer): Buffer {
  return derTlv(0x04, buf)
}

function toPem(der: Buffer, label: string): string {
  const lines = der.toString('base64').match(/.{1,64}/g) ?? []
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`
}

function generateLocalCertPair(): { caCertPem: string; leafCertPem: string; leafKeyPem: string } {
  // sha256WithRSAEncryption (1.2.840.113549.1.1.11)
  const sigAlg = derSeq(derOid([0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00]))
  const now = new Date(Date.now() - 86_400_000)
  const caExp = new Date(Date.now() + 3650 * 86_400_000)
  const leafExp = new Date(Date.now() + 365 * 86_400_000)

  // 1. Root CA (CN=AEGI Local Root CA, BasicConstraints CA:TRUE, KeyUsage keyCertSign|cRLSign)
  const caKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const caSpki = caKeys.publicKey.export({ type: 'spki', format: 'der' })
  const caName = derSeq(derSet(derSeq(derOid([0x55, 0x04, 0x03]), derUtf8('AEGI Local Root CA'))))
  const caExtBasic = derSeq(
    derOid([0x55, 0x1d, 0x13]),
    Buffer.from([0x01, 0x01, 0xff]),
    derOctetString(derSeq(Buffer.from([0x01, 0x01, 0xff]))),
  )
  const caExtKu = derSeq(
    derOid([0x55, 0x1d, 0x0f]),
    Buffer.from([0x01, 0x01, 0xff]),
    derOctetString(derBitString(Buffer.from([0x06]), 1)),
  )
  const caTbs = derSeq(
    derTlv(0xa0, derInt(2)),
    derInt(crypto.randomBytes(12)),
    sigAlg,
    caName,
    derSeq(derUtcTime(now), derUtcTime(caExp)),
    caName,
    caSpki,
    derTlv(0xa3, derSeq(caExtBasic, caExtKu)),
  )
  const caSig = crypto.sign('sha256', caTbs, caKeys.privateKey)
  const caCertPem = toPem(derSeq(caTbs, sigAlg, derBitString(caSig)), 'CERTIFICATE')

  // 2. Server Leaf Certificate (CN=127.0.0.1, SAN=DNS:localhost,IP:127.0.0.1, BasicConstraints CA:FALSE, EKU serverAuth)
  const leafKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
  const leafSpki = leafKeys.publicKey.export({ type: 'spki', format: 'der' })
  const leafName = derSeq(derSet(derSeq(derOid([0x55, 0x04, 0x03]), derUtf8('127.0.0.1'))))
  const leafExtBasic = derSeq(
    derOid([0x55, 0x1d, 0x13]),
    Buffer.from([0x01, 0x01, 0xff]),
    derOctetString(derSeq()),
  )
  const leafExtKu = derSeq(
    derOid([0x55, 0x1d, 0x0f]),
    Buffer.from([0x01, 0x01, 0xff]),
    derOctetString(derBitString(Buffer.from([0xa0]), 5)),
  )
  const leafExtEku = derSeq(
    derOid([0x55, 0x1d, 0x25]),
    derOctetString(derSeq(derOid([0x2b, 0x06, 0x01, 0x05, 0x05, 0x07, 0x03, 0x01]))),
  )
  const leafExtSan = derSeq(
    derOid([0x55, 0x1d, 0x11]),
    derOctetString(
      derSeq(
        derTlv(0x82, Buffer.from('localhost', 'ascii')),
        derTlv(0x87, Buffer.from([127, 0, 0, 1])),
      ),
    ),
  )
  const leafTbs = derSeq(
    derTlv(0xa0, derInt(2)),
    derInt(crypto.randomBytes(12)),
    sigAlg,
    caName,
    derSeq(derUtcTime(now), derUtcTime(leafExp)),
    leafName,
    leafSpki,
    derTlv(0xa3, derSeq(leafExtBasic, leafExtKu, leafExtEku, leafExtSan)),
  )
  const leafSig = crypto.sign('sha256', leafTbs, caKeys.privateKey)
  const leafCertPem = toPem(derSeq(leafTbs, sigAlg, derBitString(leafSig)), 'CERTIFICATE')
  const leafKeyPem = leafKeys.privateKey.export({ type: 'pkcs8', format: 'pem' }) as string

  return { caCertPem, leafCertPem, leafKeyPem }
}

let cachedBundle: LocalTlsBundle | null = null

export function ensureLocalTls(): LocalTlsBundle {
  if (cachedBundle) return cachedBundle

  const tlsDir = path.join(DATA_DIR, 'tls')
  fs.mkdirSync(tlsDir, { recursive: true })
  const jsonPath = path.join(tlsDir, 'localhost-tls.json')
  const caCertPath = path.join(tlsDir, 'aegi-local-ca.crt')

  let pair: { caCertPem: string; leafCertPem: string; leafKeyPem: string } | null = null
  if (fs.existsSync(jsonPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8')) as {
        caCertPem?: string
        leafCertPem?: string
        leafKeyPem?: string
      }
      if (parsed.caCertPem && parsed.leafCertPem && parsed.leafKeyPem) {
        const x509 = new crypto.X509Certificate(parsed.leafCertPem)
        const validToMs = Date.parse(x509.validTo)
        if (Number.isFinite(validToMs) && validToMs - Date.now() > 7 * 86_400_000) {
          pair = {
            caCertPem: parsed.caCertPem,
            leafCertPem: parsed.leafCertPem,
            leafKeyPem: parsed.leafKeyPem,
          }
        }
      }
    } catch {
      pair = null
    }
  }

  if (!pair) {
    pair = generateLocalCertPair()
    try {
      fs.writeFileSync(jsonPath, JSON.stringify(pair, null, 2), { encoding: 'utf8', mode: 0o600 })
      fs.writeFileSync(caCertPath, pair.caCertPem, 'utf8')
    } catch {
      // ignore disk write errors in read-only environments
    }
  } else if (!fs.existsSync(caCertPath)) {
    try {
      fs.writeFileSync(caCertPath, pair.caCertPem, 'utf8')
    } catch {
      // ignore
    }
  }

  const secureContext = tls.createSecureContext({
    key: pair.leafKeyPem,
    cert: `${pair.leafCertPem}${pair.caCertPem}`,
  })

  cachedBundle = {
    caCertPem: pair.caCertPem,
    caCertPath,
    leafCertPem: pair.leafCertPem,
    leafKeyPem: pair.leafKeyPem,
    secureContext,
  }
  return cachedBundle
}

/**
 * 단일 포트(기본 5199)에서 평문 HTTP 와 TLS(HTTPS) 요청을 동시에 수용한다.
 * 첫 바이트가 0x16(TLS ClientHello)이면 TLSSocket 으로 감싸고, 그 외에는 평문 HTTP 소켓으로 처리한다.
 * Slack 등 공개 배포 OAuth 앱이 https://127.0.0.1:5199/__aegi/oauth/callback 만 허용할 때 사용된다.
 */
export function attachHttpAndHttpsMultiplexer(server: http.Server, secureContext: tls.SecureContext): void {
  const listeners = server.listeners('connection') as Array<(socket: net.Socket) => void>
  const httpConnListener = listeners[0]
  if (!httpConnListener) return

  server.removeAllListeners('connection')
  server.on('connection', (socket: net.Socket) => {
    const onReadable = () => {
      const firstByte = socket.read(1) as Buffer | null
      if (!firstByte) return
      socket.removeListener('readable', onReadable)
      socket.unshift(firstByte)
      if (firstByte[0] === 0x16) {
        const tlsSocket = new tls.TLSSocket(socket, {
          isServer: true,
          secureContext,
        })
        tlsSocket.on('error', () => {
          socket.destroy()
        })
        httpConnListener.call(server, tlsSocket)
      } else {
        httpConnListener.call(server, socket)
      }
    }
    socket.on('readable', onReadable)
    socket.on('error', () => {
      socket.destroy()
    })
  })
}
