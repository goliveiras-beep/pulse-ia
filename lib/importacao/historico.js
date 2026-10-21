// lib/importacao/historico.js — dados exportados em 2026-10-21 dos artefatos do claude.ai (somente leitura):
// "Preventiva das Antenas — Checklists" (coleção checklists, config/sla) e "Registro de alterações do patch de RF"
// (coleção alteracoes). Um registro de teste (17/10, Lucas) foi deixado de fora de propósito (decisão do Guilherme). Usado uma única vez por lib/routes/importar-historico.js; remover depois da importação.
export const HISTORICO = {
 "antenas": [
  {
   "idOrigem": "5i6hlv6nzlwg3fkync51",
   "ajustePend": {
    "RX01": true
   },
   "antenas": [
    "RX01"
   ],
   "avaliador": {
    "assinatura": "data:image/jpeg;base64,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",
    "data": "2026-09-02",
    "em": "2026-10-12T23:21:02.932Z",
    "nome": "Thiago Russo",
    "obs": "",
    "parecer": "Aceite condicionado às pendências do relatório",
    "userId": "u_fYtR0p0q4vkXE5lEyrImIQ"
   },
   "criadoEm": "2026-10-12T21:25:06.823Z",
   "criadoPor": "u_fYtR0p0q4vkXE5lEyrImIQ",
   "envio": {
    "em": "2026-10-12T23:21:09.047Z",
    "id": "1a1326b82f6fd1d4",
    "para": [
     "trusso@livemode.com"
    ],
    "pdf": true,
    "status": "enviado"
   },
   "execucao": {
    "continuacao": {
     "id": "9bygrmsdr50ciu58kcro",
     "os": "LM102026001-C1"
    },
    "motivo": "Conflito de agenda da contratada",
    "pendente": "A equipe técnica trabalhou apenas na antena RX01 e de forma parcial, ficando pendências cruciais para a liberação da mesma.  ",
    "retorno": "2026-10-02",
    "situacao": "parcial"
   },
   "executor": null,
   "ident": {
    "abertura": "",
    "agendamento": "2026-09-30",
    "chamado": "",
    "data": "2026-10-01",
    "executor": "Thiago Quintal",
    "normalizacao": "",
    "obs": "Tempo Nublado",
    "os": "LM102026001",
    "problema": "",
    "tecnicos": "Rodrigo Cesar"
   },
   "materiais": {},
   "ncAcoes": {},
   "ncs": [],
   "niveis": {
    "RX01|L": {
     "antes": "14",
     "margemAntes": "12.9"
    },
    "RX01|R": {
     "antes": "17.2",
     "margemAntes": "7.8"
    }
   },
   "obs": {
    "E1|RX01": "Não foi realizado o apontamento fino",
    "E2|RX01": "Existem pendências",
    "L3|RX01": "Mayler Craquelado ",
    "V1|RX01": "Atividade não realizada",
    "V2|RX01": "Atividade não realizada"
   },
   "resp": {
    "A1|RX01": "OK",
    "A2|RX01": "OK",
    "C1|RX01": "OK",
    "C2|RX01": "OK",
    "E1|RX01": "NC",
    "E2|RX01": "NC",
    "F1|RX01": "OK",
    "F2|RX01": "OK",
    "L1|RX01": "OK",
    "L2|RX01": "OK",
    "L3|RX01": "NC",
    "P1|RX01": "OK",
    "P2|RX01": "OK",
    "R1|RX01": "OK",
    "R2|RX01": "OK",
    "R3|RX01": "OK",
    "V1|RX01": "NC",
    "V2|RX01": "NC"
   },
   "status": "concluido",
   "tipo": "plus"
  }
 ],
 "patchrf": [
  {
   "idOrigem": "0xeim0s6w38y3dvk9ddm",
   "autorId": "u_fYtR0p0q4vkXE5lEyrImIQ",
   "concluidoEm": "2026-10-17T21:29:13.093Z",
   "concluidoPor": "u_fYtR0p0q4vkXE5lEyrImIQ",
   "concluidoPorNome": "Thiago Russo",
   "criadoEm": "2026-10-17T21:29:13.093Z",
   "de": "Q1-2.3",
   "dispositivo": "IRD1",
   "emailEnviadoEm": "2026-10-17T21:29:18.120Z",
   "emailErro": null,
   "entrada": 3,
   "motivo": "Normalização ao mapa oficial padrão",
   "obs": "",
   "para": "Q3-3.2",
   "rascunhoEm": null,
   "semAnexo": false,
   "status": "concluido",
   "tecnico": "Thiago Russo",
   "tipo": "Normalização ao padrão",
   "ts": "2026-10-17T21:29:13.093Z",
   "versao": 2
  }
 ],
 "sla": {
  "corr_d": 2,
  "emerg_d": 2,
  "inicio": "2024-07-03",
  "nc_h": 96,
  "plus_int": 365,
  "prev_int": 90,
  "preventiva": 15,
  "reinc_d": 90
 }
};
