// lib/booking/schema.js
// Modelo de dados do modulo de Booking (extracao de parametros de sinal de
// documentos de fornecedor). Ver Especificacao - Modulo de Parametros de Sinal e
// Prazos de Booking, secao 3 - esta e o contrato central, os outros modulos
// (revisao/gravacao no Airtable, prazos, entrada por e-mail) dependem dele.
//
// Todo .describe() abaixo e o que vira a description no JSON Schema mandado pro
// Claude via zod-to-json-schema - NAO e comentario decorativo (zod-to-json-schema
// descarta comentarios //). Cada um corresponde a uma armadilha ja observada em
// producao (ver secao 3.2.2 e "Armadilhas conhecidas" da spec) - nao simplificar.
import { z } from 'zod';
import { canonicalIso } from './dates.js';

export const Provider = z.enum(['vivaro', 'sportcast', 'eurovision', 'conmebol', 'outro']);
export const ReferenceType = z.enum(['synopsis', 'ebu_ref', 'service_order', 'event_number', 'outro']);
export const Medium = z.enum(['satellite', 'srt', 'udp', 'rtmp', 'fiber', 'outro']);
export const PathRole = z.enum(['main', 'backup', 'unknown']);
export const EncryptionType = z.enum(['biss1', 'biss2', 'hmcrypt', 'passphrase', 'clear', 'desconhecido']);
export const Confidence = z.enum(['high', 'medium', 'low', 'absent']);

// Instante ISO-8601 com fuso explicito, ou null. Ver canonicalIso em dates.js
// (Armadilha 1: Date.parse sem fuso e hora LOCAL, varia por maquina).
export const Instant = z.string().nullable().superRefine((v, ctx) => {
  if (v === null || String(v).trim() === '') return;
  if (canonicalIso(v) === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `"${v}" nao e ISO-8601 com fuso explicito. Use "2026-05-26T18:15:00Z".`,
    });
  }
}).transform((v) => canonicalIso(v));

export const SatelliteParams = z.object({
  satelliteName: z.string().nullable().describe('Nome do satelite, ex.: "SES-14".'),
  orbitalPosition: z.string().nullable().describe('Posicao orbital, ex.: "47.5 deg West".'),
  transponder: z.string().nullable().describe('Ex.: "HEL 19 - HER 19".'),
  channel: z.string().nullable().describe(
    'Canal do transponder como TEXTO, ex.: "19A72", "CH12/4". Nao e numero - nao converter.'),
  channelBandwidthMhz: z.number().nullable().describe('Largura de banda do canal em MHz, ex.: 72.'),
  serviceSlot: z.string().nullable().describe('Ex.: "SERVICE 09", "SERVICE 15 ASI".'),
  serviceName: z.string().nullable().describe(
    'Nome do servico de satelite como consta no documento, ex.: "GAM VS MEL SPA". ' +
    'Isto identifica o SERVICO, nao o documento - nao usar como referenceNumber.'),
  serviceId: z.string().nullable(),
  uplinkFreqMhz: z.number().nullable().describe('Frequencia de uplink em MHz, ex.: 6381.5.'),
  uplinkPolarization: z.string().nullable().describe('"LHCP" ou "RHCP" - cuidado com grafias emendadas como "POLLHCP".'),
  downlinkFreqMhz: z.number().nullable().describe('Frequencia de downlink em MHz, ex.: 4156.5.'),
  downlinkPolarization: z.string().nullable().describe('"RHCP" ou "LHCP".'),
  modulation: z.string().nullable().describe('Ex.: "16APSK", "8PSK".'),
  symbolRateMsps: z.number().nullable().describe('Taxa de simbolo em Msps, ex.: 70.0.'),
  fec: z.string().nullable().describe('Forward Error Correction, ex.: "2/3", "3/4".'),
  rollOff: z.number().nullable().describe('Ex.: 0.10.'),
  pilot: z.boolean().nullable(),
  carrierMode: z.string().nullable().describe('Ex.: "NS4", "MCPC", "DVB-S2".'),
  nlcMode: z.string().nullable().describe('Ex.: "Off".'),
});

export const IpParams = z.object({
  protocol: z.string().nullable().describe(
    'Transporte de video como o documento descreve, ex.: "UDP MPEG4/H.264". ' +
    'NAO indica o esquema da URL (srt://) - o esquema se decide pelo campo "mode": ' +
    'so SRT tem listener/caller/rendezvous.'),
  mode: z.enum(['listener', 'caller', 'rendezvous', 'desconhecido']).nullable(),
  url: z.string().nullable().describe('Ex.: "srt://185.148.231.199:40106". Preencher junto com host/port quando algum estiver ausente.'),
  host: z.string().nullable().describe('Ex.: "18.157.139.26". Preencher junto com url quando algum estiver ausente.'),
  port: z.number().nullable(),
  minLatencyMs: z.number().nullable().describe(
    'Latencia minima EXIGIDA para o evento. Documentos do Sportcast tambem citam o ' +
    'default de 200ms do protocolo SRT - esse default NAO e este campo, so preencha ' +
    'com o valor exigido explicitamente pelo documento.'),
  whitelistCidrs: z.array(z.string()).describe('IPs NOSSOS que o fornecedor libera no firewall dele, formato CIDR.'),
  resourceName: z.string().nullable().describe('Ex.: "GNVE ZZEBU/GNVE_04/C05 TX LSNR 22/S02".'),
});

export const FiberParams = z.object({
  serviceDescription: z.string().nullable().describe('Ex.: "Fiber + Encoding + Decoding".'),
  bandwidthMbps: z.number().nullable(),
  durationMinutes: z.number().nullable().describe('Duracao do SINAL. Nao confundir com approxOutMinutes.'),
  approxOutMinutes: z.number().nullable().describe(
    'Campo "Approx out" da Vivaro: duracao aproximada para FATURAMENTO. ' +
    'NAO e a duracao do sinal - essa e durationMinutes.'),
});

export const VideoParams = z.object({
  standard: z.string().nullable().describe('Ex.: "HD 1080i 60Hz 16:9".'),
  resolution: z.string().nullable(),
  frameRate: z.string().nullable().describe('Ex.: "59.94", "60".'),
  aspectRatio: z.string().nullable(),
  codec: z.string().nullable().describe('Ex.: "MPEG4/H.264", "HEVC".'),
  chromaSubsampling: z.string().nullable().describe('Ex.: "420", "422".'),
  bitrateMbps: z.number().nullable(),
  dynamicRange: z.string().nullable().describe('Ex.: "SDR".'),
});

export const AudioChannel = z.object({
  channel: z.number().describe('Numero do canal de audio (1..16) - e NUMERO, nao texto.'),
  label: z.string().describe(
    'Rotulo do canal como esta no documento. Use "-" para canal que aparece no ' +
    'documento e esta vazio: canal vazio e informacao, nao omitir a entrada.'),
});

export const Encryption = z.object({
  type: EncryptionType,
  key: z.string().nullable().describe('SEGREDO - chave de criptografia (BISS etc). Tratar como dado sensivel na exibicao/log.'),
});

export const SignalPath = z.object({
  label: z.string().describe('Rotulo do caminho como no documento, ex.: "Satelite Americas".'),
  medium: Medium,
  role: PathRole.describe('"main"/"backup" quando o documento traz dois caminhos redundantes (ex.: mesma passphrase em dois recursos SRT); "unknown" quando nao ha como saber.'),
  origin: z.string().nullable().describe('Ponto de origem do sinal, ex.: "DESPCA KOLN", "RIO-GLOBOSAT". Isto NAO e o fornecedor do documento.'),
  destination: z.string().nullable().describe('Ex.: "BRLVMD Rio De Janeiro".'),
  startUtc: Instant,
  endUtc: Instant,
  satellite: SatelliteParams.nullable(),
  ip: IpParams.nullable(),
  fiber: FiberParams.nullable(),
  video: VideoParams.nullable(),
  encryption: Encryption.nullable(),
  audio: z.array(AudioChannel),
  notes: z.string().nullable(),
});

export const SourceRef = z.object({
  provider: Provider.describe(
    '"sportcast" cobre os dois formatos do Sportcast (Livestream Details e Satellite ' +
    'Details, emitido via EBU). Origem citada no documento (ex.: "RIO-GLOBOSAT") nao e o provider.'),
  referenceType: ReferenceType,
  referenceNumber: z.string().nullable().describe(
    'Numero PURO da referencia, sem "version"/"amendment" embutido. Ex.: "26-201773", nao "26-201773 v2 amd2".'),
  version: z.number().nullable(),
  amendment: z.number().nullable(),
  secondaryRefs: z.array(z.string()).describe(
    'Referencias secundarias (EBU REF, SE, event number etc). Extrair sempre que existirem - ' +
    'e o dado que permite casar documentos irmaos do mesmo jogo depois.'),
  documentTitle: z.string().nullable(),
  hotline: z.string().nullable(),
  bookingContact: z.string().nullable(),
});

export const SignalEvent = z.object({
  sourceRef: SourceRef,
  competition: z.string().nullable(),
  round: z.string().nullable().describe('Transcrever fielmente como no documento, mesmo se parecer errado (ex.: rotulado "Matchday 15" numa final) - nao corrigir.'),
  eventName: z.string().nullable(),
  homeTeam: z.string().nullable(),
  awayTeam: z.string().nullable(),
  venue: z.string().nullable().describe('Cidade do JOGO (ex.: "Leipzig"). Nao confundir com os blocos origin/destination, que descrevem roteamento de sinal.'),
  transmissionType: z.string().nullable().describe('Ex.: "Multilateral", "Distribution".'),
  feedDescription: z.string().nullable(),
  transmissionStartUtc: Instant,
  transmissionEndUtc: Instant,
  kickoffUtc: Instant.describe(
    'Kick-off, frequentemente diferente do inicio da janela de transmissao - ambos importam. ' +
    'Ex.: Conmebol traz "Begin: 20:45" e "KO: 22:00", os dois devem ser extraidos.'),
  matchDateBrt: z.string().nullable().describe('DERIVADO em codigo (toMatchDateBrt) - nunca extrair do documento.'),
  signalPaths: z.array(SignalPath),
  rawText: z.string().optional(),
  sourceFileName: z.string().nullable(),
});

// O que a tool submit_extraction recebe do modelo (sem os campos derivados em codigo).
export const ToolInput = z.object({
  event: SignalEvent.omit({ rawText: true, sourceFileName: true, matchDateBrt: true }),
  confidence: z.record(z.string(), Confidence).describe(
    'Confianca por campo, chaveada por caminho pontuado. Ex.: {"kickoffUtc":"high","signalPaths.0.satellite.modulation":"medium"}.'),
  warnings: z.array(z.string()).describe('Coisas que o extrator quer que um humano olhe antes de gravar.'),
});

// O que a aplicacao passa adiante, apos validar e derivar (rawText, sourceFileName, matchDateBrt).
export const ExtractionResult = z.object({
  event: SignalEvent,
  confidence: z.record(z.string(), Confidence),
  warnings: z.array(z.string()),
});
