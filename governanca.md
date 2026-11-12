# Governança do projeto — Pulse IA

> Gerado em 2026-09-14 a partir das respostas dadas durante uma checagem do SentinelaMODE
> (`.sentinela-relatorio.md`), já que a skill `config-projeto` (que normalmente gera este arquivo)
> não estava instalada no momento. Formato conforme `livemode-brain/homologacao.md` §12.6.

- **Propriedade:** corporativa
- **Nível:** produção
- **TAG:** media
- **Monitoramento:** area
- **Dados sensíveis:** sim
- **Dono:** Guilherme Oliveira Silva (goliveiras@livemode.com)
- **Gestor da área:** Guilherme Oliveira Silva (goliveiras@livemode.com)
- **Co-owner técnico:** —

## As três condições (contrato da casa, §as_tres_portas)

| | Pergunta | Resposta |
|---|---|---|
| C1 | Se sair do ar amanhã, vira um problema pra área? | **Sim** — é o portal operacional que a equipe usa todo dia (escala, ausências, cobertura de eventos ao vivo, controle de equipamento) |
| C2 | Mostra informação que não pode ser vista por qualquer pessoa? | **Sim** — CPF, RG, endereço, data de nascimento (aba Equipe); motivo de atestado médico com anexo (aba Ausências) |
| C2-P | Entre essas informações há dados de pessoas identificáveis? | **Sim** |
| C3 | Mais de um time usa, ou decisões de mais de uma área saem daqui? | **Não** — uso concentrado na área de operações/produção |

`qtd` = 2 (C1 + C2) → **TAG media**, **propriedade corporativa**, **dados_sensiveis = C2 && C2-P = true**, **nível = produção** (obrigatório com propriedade corporativa).

## Nível de dado (para a nota de segurança)

**N3** — guarda CPF, RG, endereço, data de nascimento (aba Equipe) e documento de saúde (atestado
médico anexado, categoria sensível LGPD).

## Histórico

- 2026-09-14: primeira emissão, depois de duas rodadas de checagem do SentinelaMODE no mesmo dia
  (nota final: grau A, 99/100). Ver `.sentinela-relatorio.md` na raiz do repositório para o
  relatório completo — local até subir ao portal `sentinela.livemode.space`.
