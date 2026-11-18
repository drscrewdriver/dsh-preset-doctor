# dsh-preset-doctor

**Doutor de presets do DSH**: após carregado, varre automaticamente declarações de Agent presets quebradas, realinha **mecanicamente as corrigíveis à sintaxe da versão atual** (backup `.bak` antes de escrever, escrita atômica, idempotente) e reporta as não-mecanicamente-corrigíveis uma a uma (arquivo:linha + motivo + sugestão).

Compatível com **as cinco linhas principais do DeepSeek Harness 0.1.1+** (mecanismo declarativo `cordis.patch.yml` a partir do 0.1.7+; formato nativo de diretório no 0.1.5 e anteriores, com reparo no próprio `agent.cordis.yml`); em tempo de execução o ramo de adaptação é escolhido sozinho conforme a versão do host (ver abaixo).

---

## Por que ele é necessário

O DSH 0.1.7 substituiu o mecanismo de presets — de «varredura de diretórios `.agent-presets/<id>/` + dois arquivos» para «registro declarativo via `cordis.patch.yml`» —, e entre 0.1.0 e 0.1.7 houve 7 mudanças que quebravam os templates antigos (renomeação de pacotes, remoção de chaves de config da persona, semântica de caminhos locais etc.). A quebra aparece na UI apenas como «falha ao carregar», **sem linha, sem motivo**.

Este plugin entrega esses fatos puramente mecânicos a código determinístico, **sem nenhuma intervenção de LLM** no processo.

## Matriz de detecção e reparo

| Regra | O que detecta | Tratamento |
|---|---|---|
| R-LEGACY | diretórios no formato antigo `.agent-presets/<id>/` (simplesmente não se registram no novo mecanismo) | **Automático**: migra para declaração de patch (transformação estrutural L1 + renomeação/reescrita de caminhos L2 de uma vez) |
| R-PKG-RENAMED | pacote referenciado presente na tabela de migração (ex.: `dsh-workflow-worker-thread` → `dsh-workflow-ptc`) | **Automático**: substitui o nome do pacote + sincroniza o id da linha |
| R-KEY-RENAMED | `config.text` da `persona` (removido desde 0.1.3-alpha.2) | **Automático**: divide em `prefix` + `suffix` (linhas cwd independentes vão ao suffix, o resto ao prefix) |
| R-LOCAL-PATH | `name` começando com `./`/`../` | **Automático**: reescreve para URL absoluta `file://`, marcando «API de plugin não verificada» |
| R-PKG-MISSING | pacote irresolvível tanto na instalação em execução quanto no node_modules do profile, e ausente da tabela de migração | **Só relatório** (a substituir / b remover / c confirmar compatibilidade de terceiros) |
| R-DUP-ID | ids de linha duplicados no patch; o mesmo id de preset declarado duas vezes entre home/profile | **Só relatório** (não decide por você qual cópia excluir) |
| R-ID-SHADOWED | id de preset igual ao de um preset embutido da instalação (desde 0.1.2-alpha.1 o shipped vence, a declaração não tem efeito) | **Só relatório** (cobertura intencional pode ser ignorada; recomenda-se id customizado) |
| R-STRUCT / R-YAML | falta id/config/plugins, entradas não-insert, erros de sintaxe YAML | **Só relatório** |
| R-INJECT-* | injeção de prompt em presets (`注入/*.md` + linha do entregador): frontmatter ausente, BOM, rebaixamento de role, order zerado, `enabled` grafado errado, nomes/posições duplicadas, diretório inexistente, escrito sem conexão | BOM **removido automaticamente** (nenhum outro byte tocado); o resto **só relatório** (com `.md:linha`) |

> A tabela acima é o tratamento do ramo main/0.1.7 (declarativo); **os ramos de adaptação de linhas antigas (≤0.1.5) usam formato nativo de diretório: R-LEGACY não dispara, R-LOCAL-PATH é isento, e o reparo é feito no próprio arquivo do diretório** — ver a seção «Ramos de adaptação» abaixo.

## Arquitetura: changelog aditivo + convergência em cadeia (por que a deriva de versões não assusta)

A tabela de migração não é um snapshot de «pares de versão», e sim um **changelog aditivo** (`src/tables/changes.json`): cada registro diz «a partir de tal versão do DSH, o token antigo quebra → nova forma» (`brokenIn` + `from`/`to`).

- **Novo DSH mudou o template → apenas acrescenta-se uma entrada**, as históricas nunca são reescritas; não existe tabela N×N de pares de versão
- **Convergência em cadeia**: A→B, B→C resolvem-se automaticamente em A→C (ponto fixo) — presets escritos nas quatro eras 0.1.0 / 0.1.2 / 0.1.5 / 0.1.7 convergem todos para **a instalação em execução atual** com a mesma tabela (origens diferentes, destino único; a diferença de ramo se manifesta só nos tokens quebrados que cada um encontra; há teste fixando esse comportamento)
- **Portão relativo à instância em execução**: só corrige automaticamente quando o nome antigo está morto na instalação atual **e** o novo existe — a mesma regra é segura para qualquer instalação
- **Reporta a era de origem**: cada preset mostra «escrito em ≤X» e os nós de versão que precisa atravessar (ex.: `escrito em ≤0.1.3-alpha.2, atravessa 0.1.3-alpha.2 → 0.1.6-alpha.1`)
- **Tabela de autossalvamento do usuário**: `$DSH_HOME/preset-manager/tables.user.json` (mesmo schema do embutido, `from` homônimo sobrepõe o embutido) — quando uma nova versão do DSH quebrar algo, não é preciso esperar uma release do plugin

**Revisão de deriva 0.2.0 (2026-09-30, verificação dura por duas tags git)**: o `standard.patch.yml` é byte-idêntico entre `dsh-v0.1.7-alpha.1` e `dsh-v0.2.0-rc.2`, e o conjunto de referências dos 4 pacotes de presets oficiais tem diferença zero; 0.2.0-rc.2 era o npm latest da época. Se algum 0.2.x futuro derivar, basta acrescentar uma entrada em `changes.json` para cobrir todas as origens históricas.

## Eras: qual preset escrito em qual versão encontra quais eventos

Por **sintaxe** de preset (combinação de tokens) há apenas quatro eras; o número de versão não muda o caminho de processamento — o que o muda são os tokens quebrados contidos no preset:

| Era de escrita | Faixa de versões | Assinatura de tokens | Eventos encontrados | Nós a atravessar |
|---|---|---|---|---|
| Era text | 0.1.0 ~ 0.1.3-alpha.1 (**inclui 0.1.1, 0.1.2**) | `text` de persona + nomes antigos + diretório legado | D + F + G | 0.1.3-alpha.2 → 0.1.6-alpha.1 → 0.1.7-alpha.1 |
| Era prefix | 0.1.3-alpha.2 ~ 0.1.6-alpha.0 (**0.1.5 como representante**) | `prefix` de persona + nomes antigos + diretório legado | F + G | 0.1.6-alpha.1 → 0.1.7-alpha.1 |
| Era ptc | 0.1.6-alpha.1 ~ 0.1.6-alpha.2 | nomes novos + diretório legado | G | 0.1.7-alpha.1 |
| Corrente | ≥0.1.7-alpha.1 | patch declarativo | nenhum (0 findings) | — |

> Nota: entre 0.1.1 e 0.1.2 não houve quebra alguma que afetasse a sintaxe de presets do usuário (o B de 0.1.2-alpha.1 é o preset embutido de mesmo id vencendo, o C é o padrão de tool-web.fetch — ambos mudanças de comportamento, não itens corrigíveis por sintaxe, reportados como advisory); o requisito de realm `isolate` (A) já valia desde 0.1.0-rc.7, e presets que rodavam em 0.1.0/0.1.1 são naturalmente conformes. Portanto **0.1.0/0.1.1/0.1.2 pertencem todos à era text, sem tratamento separado por número de versão**. Em volume, a era prefix (0.1.3-alpha.2~0.1.6, a mais duradoura) tem o maior inventário de presets, a era text vem depois — ambas cobertas pelo teste «quatro eras convergindo pela mesma tabela».

### Ramos de adaptação: peer por linha host / destino de processamento / algoritmo

A ferramenta escolhe sozinha o ramo de adaptação **pela versão do host em execução** (`src/tables/branches.json), aditivo só). Um ramo por linha principal antiga, com baseline de peer, destino e patamar de algoritmo próprios:

| Ramo | Faixa de host | baseline peer (vendor/cordis) | Destino | Formato de preset | Algoritmo |
|---|---|---|---|---|---|
| main (0.2.0) | ≥0.2.0-rc.1 | 4.0.4 | 0.2.0-rc.2 | patch declarativo | reparo por span de patch + migração L1+L2 de diretórios legados |
| dsh-0.1.7 | ≥0.1.7-alpha.1 <0.2.0-rc.1 | 4.0.4 | 0.1.7-rc.2 | patch declarativo | igual ao main (mesma tabela de eventos) |
| dsh-0.1.5 | ≥0.1.5-alpha.1 <0.1.7-alpha.1 | 4.0.2 | 0.1.5-rc.3 | diretório (nativo) | não migra, não varre patch; reparo **no próprio arquivo** de diretório pelos tokens da tabela |
| dsh-0.1.2 | ≥0.1.2-alpha.1 <0.1.5-alpha.1 | 4.0.2 | 0.1.2-rc.1 | diretório (nativo) | idem; sem eventos de quebra antes do destino → na prática só relatório |
| dsh-0.1.1 | <0.1.2-alpha.1 | 4.0.1 | 0.1.1-rc.2 | diretório (nativo) | idem |

- **A tabela de eventos é truncada pelo destino do ramo**: o ramo 0.1.2 não enxerga o evento da persona (só quebra em 0.1.3-alpha.2) e não «corrige» indevidamente um `text` legal naquela linha; a tabela de autossalvamento (`tables.user.json`) **não é truncada** — sobrepor explicitamente a detecção do ambiente em execução é justamente o sentido de se autosocorrer
- **Ramos de diretório não migram**: hosts ≤0.1.5 não têm mecanismo declarativo, o diretório é o próprio preset — gerar `cordis.patch.yml` não teria sentido; o reparo cai no arquivo original `agent.cordis.yml` (mesmo contrato de .bak/escrita atômica/idempotência), e caminhos locais relativos eram a semântica legal da época, sem falso positivo
- **Hosts 0.1.6-alpha** caem no ramo dsh-0.1.5: nomes antigos de pacote são julgados pelo portão da instalação em execução (só corrige quando o antigo está morto + o novo vivo), seguro nas duas pontas 0.1.5/0.1.6
- **Sem detecção da versão do host, retrocede ao main** (comportamento idêntico ao 0.3.x); a publicação npm segue dist-tags por linha (`dsh-0.2.0` / `dsh-0.1.7` / …, alinhada à convenção host-matrix)

### table-build: propostas automáticas de entradas de mudança (mantenedor)

```bash
npm run table-build -- --repo <repositório-fonte dsh> --from dsh-v0.1.5-rc.3 --to dsh-v0.2.0-rc.2 [--json]
```

- Diff do conjunto de referências de pacotes entre os presets oficiais das duas versões; «exatamente uma remoção + uma adição no mesmo arquivo de preset» → propõe evento `package-rename`; qualquer ambiguidade vai para a lista unpaired (sem chute)
- Códigos de saída: 0=sem mudança, 2=há propostas, 3=há itens aguardando humano
- Calibração em máquina real: `dsh-v0.1.5-rc.3 → dsh-v0.1.6-alpha.1` redescobre sozinho o renomeio histórico F (workflow-worker-thread → workflow-ptc, 1 proposta, zero falso positivo); `dsh-v0.1.7-alpha.1 → dsh-v0.2.0-rc.2` não propõe nada (consistente com a revisão byte a byte)
- **Propostas exigem conferência manual e commit antes de acrescidas a `src/tables/changes.json`** — o changelog é âncora de confiança, acrescentar é sempre ato humano
- Eventos de config-key (ex.: renomeio de chave da persona) não são deriváveis unicamente do diff de presets (ambiguidade semântica); exigem arqueologia manual + evidência de commit

## Lista de observação de upgrade: «onde os presets moram» muda com a versão

**Muda, e muda três coisas**: o destino (que arquivo/diretório), o formato (diretório → patch declarativo), o conteúdo (as linhas oficiais e as exports dos pacotes). Após subir o host, percorra a lista abaixo.

### Três gerações de destino (os caminhos que o doctor realmente varre)

| Geração | Destino dos presets do usuário | Formato |
|---|---|---|
| ≤ 0.1.6 (inclui 0.1.1/0.1.2/0.1.5) | `$DSH_HOME/.agent-presets/<id>/` (`agent.cordis.yml` + `preset.yml`) | o diretório é o próprio preset |
| ≥ 0.1.7 | `$DSH_HOME/cordis.patch.yml` (camada home, vale para todo profile) | patch declarativo |
| ≥ 0.2.0 (multi-profile) | `$DSH_HOME/profiles/<name>/cordis.patch.yml` (`desktop` / `web` / `tauri` podem coexistir) | patch declarativo |

Três armadilhas, por frequência de tombos:

1. **Editar o profile errado**: `desktop` e `web` têm cada um o seu `cordis.patch.yml`; «mudei e não valeu» quase sempre significa editar o que não está rodando. O cartão da UI toma como fonte exatamente o arquivo que o processo em execução lê — ele é a referência.
2. **Diretório antigo ainda lá**: resíduo de `.agent-presets/` + patch de profile coexistindo, ambos declarando o mesmo id de preset → o antigo eclipsa o novo (`R-LEGACY-CONFLICT`). Faça a mesclagem antes de arquivar; não apague o diretório na mão e pronto.
3. **Os presets oficiais shipped são somente leitura**, e sua posição muda com a forma de instalação: repositório `packages/bundle/web-app/presets/*.patch.yml`; instalação CLI `…/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/`; desktop `…/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/` (a cópia dentro do asar é a que o host desktop realmente usa). **Nunca os trate como destino seu para editar** — customização se faz por cobertura na camada do profile.

### Cinco passos pós-upgrade

| # | O que olhar | Como conferir |
|---|---|---|
| 1 | versão do host + profile em vigor | `detectedVersion` no topo do cartão e sua origem (`import.meta.resolve` / `fs:` / `electron:`); comando `dsh --version` |
| 2 | os três destinos ainda existem | o relatório de `/preset-doctor scan` traz «fontes varridas: N», uma linha `[home] / [profile/<nome>] / [legacy-dir]` por fonte, com arquivo e contagem de linhas; qual camada falta fica evidente |
| 3 | a sintaxe ainda bate | os findings do mesmo `scan`: `0 findings` prova que destino e sintaxe estão certos; `R-LEGACY-*` = ainda parado no destino antigo |
| 4 | os componentes ainda existem | badges das linhas do cartão: aparecer «o host não fornece» = aquela versão removeu o pacote ou a sub-rota. Exemplo: `0.2.2-rc.1` tirou `dsh-tool-subagent-control/list-agents` (`0.2.1-rc.5` ainda tinha) |
| 5 | a composição oficial derivou | «linhas oficiais ausentes» do cartão lista, por preset de referência, as linhas faltantes e em qual pacote devem ficar, ex.: `+time-context` `+tool-schedule`, `-tool-subagent-codex` `-tool-ralph` |

Os passos 2~5 são totalmente automáticos (varredura na partida + cartão); o 1 e «onde ficam os oficiais shipped» pedem um olhar humano.

## Injeção de prompt de presets: lê e reporta

Presets também podem escrever prompts em arquivos — a estrutura do `dsh-preset-studio`: `<diretório do preset>/注入/*.md`, frontmatter com `name / role / order / enabled`, corpo é o prompt, e uma linha do entregador dentro do preset o conecta ao system prompt:

```yaml
- id: studio-inject
  name: 'dsh-preset-studio/inject'
  config:
    dir: '<diretório do preset>/注入'
```

O entregador é **silencioso** diante de arquivos ruins: a única aparência é «esse prompt parece que não pegou». Esta ferramenta usa um leitor campo a campo alinhado ao entregador (`src/prompts/frontmatter.js`) para lê-los e reportar o que o entregador engoliria em silêncio:

| Comportamento real do entregador | O doctor reporta |
|---|---|
| BOM no cabeçalho → `^---` falha → arquivo inteiro descartado | `R-INJECT-BOM` (remove o BOM **automaticamente**) |
| Sem frontmatter / cerca não fechada → pula o arquivo | `R-INJECT-FORMAT` |
| Corpo todo vazio → pula o arquivo | `R-INJECT-EMPTY` |
| `role` errado → rebaixado em silêncio para `system` | `R-INJECT-FIELD` |
| `order` não numérico → zerado (a ordem passa a ser do nome do arquivo) | `R-INJECT-FIELD` / `R-INJECT-ORDER` |
| `enabled` grafado errado (`ture`) → tratado como **habilitado** | `R-INJECT-FIELD` |
| Campo escrito como bloco escalar (`name: >`) → ilegível | `R-INJECT-FIELD` |
| Nome de contribuição duplicado (`custom-inject:<name>`) → sem deduplicação | `R-INJECT-DUP` |
| `{{model}}`/`{{cwd}}` no corpo → `interpolate:false`, placeholders entram crus no prompt | `R-INJECT-VAR` |
| `config.dir` ausente / `~` não expandido / relativo pelo cwd do processo / diretório não existe | `R-INJECT-DIR` |
| Sem `.md` no diretório, ou todos com `enabled:false` → linha existe, entrega 0 | `R-INJECT-EMPTY-DIR` |
| `<home>/presets/<id>/注入` tem prompts sem nenhuma linha de entregador apontando | `R-INJECT-UNWIRED` |

**Onde olhar**: dentro de cada cartão de preset, depois do toggle da linha, há uma **caixa «system prompt (N seções · M desligadas em linha · K injetadas)»** (expandida por padrão) — primeiro lista as **seções de prompt do patch** (`persona · prefix`, `plan-mode · section`, `description` sobrescrito por linha de ferramenta, com contagem de caracteres, prévia de uma linha e rótulo pequeno; chaves conhecidas não têm limite de tamanho, desconhecidas só contam se longas o bastante, para não tomar metadados `description` por prompt), **mostrando o valor resolvido conforme o toggle da linha**: seções desligadas ganham rótulo «desligada», nome riscado, e não contam nas N (ex.: o `persistent-bash` do preset oficial `minimal` está desligado no Windows); depois lista as entradas do **diretório de injeção** (`nome role/order caracteres`, desligadas riscadas, problemas de formato com ⚠). Fora do cartão fica apenas «outros diretórios de injeção (não conectados a um cartão de preset)».

**Editável**: cada seção tem «editar» — expande o texto num textarea, pede confirmação ao salvar e grava via `/prompt-write`: **substitui apenas o intervalo de bytes daquele valor** (blocos escalares preservam `|`/`|-`/`>` e a indentação, linha única continua linha única, CRLF acompanha o arquivo), `.bak` + escrita atômica antes de gravar, mesmo conteúdo de novo → `skipped`. Recusa: esvaziar o corpo, chaves não-prompt, valores de expressão `!!js`.

**Limites**: exceto a limpeza de BOM e a edição explícita dentro do cartão (confirm + `.bak` + substituição por span), esta ferramenta **jamais altera prompts do usuário por conta própria** — texto, posição, toggles: só relatório, nunca mudança.

### Mantenedor: varredura completa do mapa de componentes

```bash
node tools/component-map.mjs                 # mescla as três fontes → src/tables/component-map.json
node tools/component-map.mjs --print         # imprime a tabela linha a linha também
node tools/component-map.mjs --no-repo --no-asar   # varre só a instalação CLI
```

- Três fontes: árvore-fonte `deepseek-harness`, bundle da instalação global CLI, `app.asar` do Desktop (cabeçalho do asar decodificado à mão, sem depender de Electron)
- Produto: `id → pacote/sub-rota + classificação + disponibilidade por versão` (ex.: `list-agents` = `0.2.1-rc.5 ✓ / 0.2.2-rc.1 ✗`)
- **Não é critério de disponibilidade**: se a linha levanta continua sendo a sonda de runtime a decidir (`resolvePkg` + ler as `exports` do pacote para a sub-rota); o mapa só serve dicas de linha faltante, classificação de componentes e comparação entre versões

## Contrato de segurança de escrita

- Reparo de patch existente é sempre **substituição de span em nível de texto**: bytes fora do intervalo 100% intocados (expressões `!!js`, comentários, indentação são preservados por natureza)
- Backup automático `<file>.bak-<timestamp>` antes de escrever; substituição atômica via arquivo temporário + rename
- Idempotência: a mesma entrada rodada de novo, segunda passada com 0 escritas
- UTF-8 sem BOM; final de linha CRLF/LF preservado
- Escrita em disco só após confirmação manual explícita: botão «sincronizar à versão atual» no cartão (com diálogo) ou o comando `/preset-doctor fix`; a varredura de partida é sempre só relatório (o interruptor mestre autoFix foi aposentado na 0.6.0)

## Uso

**Faixa de compatibilidade**: um único `0.9.x` serve todas as linhas principais do host — os ramos de adaptação se escolhem em runtime pela versão do host (ver «Ramos de adaptação» acima), sem bifurcação de código por linha. `engines.dsh` e o peer renderer `@deepseek-ai/dsh-client-ui-renderer` carregam a mesma string nas duas listas, e **ambas são intervalos limitados** `>=0.1.0-rc.2 <0.3.0-0` (piso = ponto de enumeração original; teto com `-0` barra a próxima linha host ainda não verificada; rc novos de 0.2.x dentro do intervalo instalam sem re-publicação); peer `@deepseek-ai/cordis` é `>=4.0.1 <5`. **Smoke nos ambientes de retenção do host (2026-10-05, 0.4.1)**: as cinco linhas 0.1.0-rc.8 / 0.1.1-rc.2 / 0.1.2-rc.1 / 0.1.5-rc.3 / 0.1.7-rc.2 iniciam todas verdes com o entry do plugin ativado (auto-reparo de presets plantados + `.bak` comprovados); 0.2.0 pelo canal de teste desktop. Restrição de engenharia: é **proibido importar cordis** em `src/` (a instalação de profile resolveria a cópia própria grande do plugin, formando duas instâncias com o host; este plugin deliberadamente depende só de schemastery). Instale pelo dist-tag da linha do host (até 2026-10-05; antes de 0.4.1 sair no npm, instale via tgz):

| Host DSH | Versão deste plugin | dist-tag de instalação |
|---|---|---|
| 0.2.2 | ver `package.json` | por ora via tgz (`0.8.x-local.N`) |
| 0.2.1 / 0.2.0 | ver `package.json` | `dsh-0.2.0` |
| 0.1.7 | ver `package.json` | `dsh-0.1.7` |
| 0.1.5 | ver `package.json` | `dsh-0.1.5` |
| 0.1.2 | ver `package.json` | `dsh-0.1.2` |
| 0.1.1 e anteriores | ver `package.json` | `dsh-0.1.1` |

> Os números de versão acima descrevem apenas o mapeamento de dist-tags; **a versão concreta é a do `package.json` do repositório** (o 0.4.1 nos registros de smoke é um snapshot histórico de publicação).

```bash
npm install -g dsh-preset-doctor            # latest (conforme a publicação real no npm)
dsh plugin add dsh-preset-doctor@dsh-0.2.0  # escolha a tag pela linha do host: dsh-0.1.7 / dsh-0.1.5 / dsh-0.1.2 / dsh-0.1.1
```

Após carregado (~1 s depois), varre automaticamente `$DSH_HOME/cordis.patch.yml`, `profiles/<name>/cordis.patch.yml` e o diretório legado `.agent-presets/`; resultados de reparo e relatório vão para o log. **Após upgrade do host, percorra primeiro a «lista de observação de upgrade»** (destinos de presets e componentes oficiais mudam com a versão).

A qualquer momento na sessão, gatilho manual:

```
/preset-doctor          # varredura + reparo mecânico (padrão)
/preset-doctor scan     # só varre e reporta, sem escrever
```

### Smoke em processo (passos manuais)

```powershell
# Caminho A: instalação global
npm install -g dsh-preset-doctor
# Caminho B: montado como plugin de profile
dsh plugin add dsh-preset-doctor

# Reinicie o processo DSH (o registro de presets e os plugins só carregam na partida)
# ~1 s após o início procure no log o relatório de varredura [preset-manager]; valide o comando com /preset-doctor scan na sessão
```

### Configurações

| Chave | Padrão | Descrição |
|---|---|---|
| `scanProfiles` | `true` | varre também patches de nível profile |
| `migrateLegacy` | `true` | migra automaticamente diretórios no formato antigo |
| `homeOverride` | `''` | sobrepõe o diretório-raiz varrido (testes/multi-instância) |

**Distribuição da superfície de ajustes (desde 0.5.0 com detecção de waist de três gerações, proibido ler número de versão; medido na fazenda)**:

| Linha de host | Entrada de ajustes | Descrição |
|---|---|---|
| 0.1.7-rc.1+ / 0.2.0 (**superfície de ajustes inspecionável marcada nesta publicação**) | página de plugins → detalhe da linha dsh-preset-doctor / página de detalhes do bundle | cartão client (`plugins.row.config` key=`dsh-preset-doctor#preset-manager` + `plugins.bundle.config` key=`dsh-preset-doctor`). O host **não** renderiza formulário automático volatile (na prática da 0.1.7 o painel de ajustes não expõe configuração de plugin); o Config volatile só cuida do cano de armazenamento, os dados do cartão passam pela ponte `/api/dsh-preset-doctor-settings` (renderização do cartão + gravação pela UI conferidas na 0.1.7) |
| 0.1.2-rc.1 / 0.1.5-rc.x | Ajustes → Plugins → aba de configuração de plugin | registro de ns no host via `installSection` + cartão client despachado por ns (condição de despacho = ns servido ∩ cartão `settings.plugin.item` ∩ key===ns ∩ `settingsScope.bind`; renderização do cartão + ciclo de gravação conferidos em 0.1.2/0.1.5) |
| 0.1.0-rc.x / 0.1.1-rc.x | sem UI (o shell do host não tem página de ajustes) | registrar ns no host via `register` já garante persistência + leitura/escrita pela ponte (ciclo de mutate conferido); configuração via `cordis.patch.yml` |

Nas linhas antigas, mudanças re-ancoram a fonte de config por `setSource` e valem para a próxima `/preset-doctor` e para a varredura de partida, sem reiniciar.

## Limites e responsabilidade

> **Esta ferramenta garante que o preset reparado é «sintaticamente válido e carregável»; não garante «equivalência de comportamento» com a versão antiga.**
> O efeito do reparo exige **reiniciar o processo DSH** (o registro de presets só carrega na partida).

- Pacotes removidos sem sucessor, chaves de config com semântica alterada, mudanças de API em plugins `.mjs` do usuário — indecidíveis estaticamente, apenas marcados, não sugeridos
- A tabela de mudanças embutida v1 traz dois eventos provados (`workflow-ptc`, chave `persona`); novas quebras do DSH **acrescentam** entradas; o usuário pode se adiantar com `tables.user.json`
- Só escreve arquivos de patch e backups `.bak`; não instala dependências, não mexe em `package.json`, não reinicia processos

## Diferença de posicionamento frente a pacotes vizinhos

| Pacote | Posição | Diferença |
|---|---|---|
| `@linxin666/dsh-client-ui-preset-center` | UI de gestão de ciclo de vida dos presets do mercado (instalar/desabilitar/remover) | gerencia o **ciclo de vida** de presets do mercado; esta ferramenta diagnostica e repara a **obsolescência sintática de presets locais** |
| `dsh-win32` | suíte geral de reparos para Windows | inclui legacy preset repair mas voltada a problemas Windows amplos; esta ferramenta foca presets, multiplataforma |
| PRD `preset-migrate` (documento de design) | CLI independente, tabela de migração auto-gerada | esta ferramenta = doctor-residente do plugin (pergunta em aberto 5 da PRD §13.5), para o cenário «o inventário já está quebrado» |

## Desenvolvimento

```bash
npm install
npm test   # node --test (208 casos, com migração ponta a ponta sobre fixtures de presets reais + comportamento dos ramos de adaptação + validação de formato de injeção de prompt)
npm run lint
```

Os ativos de teste vêm de presets reais de usuários: 6 diretórios em formato antigo (com `.mjs` de plugin local, expressões `!!js`, blocos escalares com linhas vazias, caracteres chineses) e 5 bases de patch convertidas à mão (que preservam um bug histórico real — um nome de pacote antigo esquecido — a ferramenta tem que corrigi-lo para o teste passar).

## License

MIT

## Superfície de terminal TUI (dsh-tui)

O dsh-tui não carrega a metade client do plugin (painéis/cartões/página de ajustes) nem alcança RPC próprio do plugin; chamadas de ferramenta mostram só um resumo de uma linha. A única superfície legível e operável por humanos restam os comandos de barra do host. Convenções de saída: linha ≤100 caracteres, total ≤40 linhas, sem ANSI, alinhamento com dois espaços; operações de escrita são dry por padrão, executam só com `--yes`; `--json` emite JSON de linha única.

| Comando | Ação |
|---|---|
| `/preset-doctor scan` | comando existente: só varre presets quebrados |
| `/preset-doctor fix` | comando existente: varredura + reparo mecânico (com backup) |

Os comandos são registrados pelo próprio plugin no lado do host (`ctx.inject(['commands'], …)`): em linhas antigas sem serviço de comandos, ficam inativos, sem erro.
