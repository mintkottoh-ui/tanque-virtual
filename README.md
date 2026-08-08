# Tanque Virtual

PWA pessoal para acompanhar o "tanque de combustível" do carro sem depender do painel real do veículo.

## O que o app faz

- **Painel**: barra de tanque (estilo medidor de combustível), litros atuais, autonomia estimada e combustível atual.
- **Trajeto**: você informa a distância percorrida e o tempo gasto; o app calcula a velocidade média e reduz o consumo estimado de acordo com a condição de trânsito (quanto mais lento, mais combustível gasto no mesmo trajeto). A barra do tanque desce automaticamente.
- **Abastecer**: registra quantos litros e de qual combustível (gasolina, etanol ou diesel), com preço por litro configurável, e enche a barra do tanque.
- **Histórico**: fica em uma aba separada (não aparece exposto no painel), agrupado por Dia / Semana / Mês, com totais de km, litros e gasto por período.
- **Configurações**: capacidade do tanque, consumo do carro na gasolina (km/L), fator de equivalência do etanol (o consumo em etanol é calculado automaticamente como gasolina × fator, padrão 0,70), consumo no diesel, preços de cada combustível, e ajuste manual do nível atual do tanque.
- **Backup**: exportar/importar os dados em JSON (tudo fica salvo apenas no `localStorage` do navegador/dispositivo).

## Como usar

É um PWA estático (HTML/CSS/JS puro, sem build). Para rodar localmente:

```bash
npx http-server -p 8080
```

Depois abra `http://localhost:8080` no navegador. No celular, use "Adicionar à tela inicial" para instalar como app (funciona offline graças ao Service Worker).

## Estrutura

```
index.html          shell do app (abas: Painel, Trajeto, Abastecer, Histórico, Config)
css/styles.css       estilos
js/app.js            lógica, cálculo de consumo e persistência (localStorage)
manifest.webmanifest metadados do PWA
sw.js                service worker (cache offline)
icons/                ícones do app
```
