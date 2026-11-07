# Primeiro pagamento real — autorização limitada

Autorização do operador em 2026-11-07: **um único pagamento de 10 FLOOF** para `FRryLSoAWsvoeiv1qJGMGP7DAYJJngVsPs`. Não autoriza abertura pública, outros destinos, valores diferentes nem repetição.

## Estado atual
- Render: `FAUCET_PAUSED=true`, `PAYOUT_INTEGRATION_APPROVED=false` no código. Manter assim até existir um percurso privado e restrito ao operador.
- VPS: `PAYMENTS_ENABLED=false`. Manter assim até limitar a execução a este único pedido.
- O endpoint `/internal/payment` atual aceita qualquer reserva válida e, se `PAYMENTS_ENABLED=true`, não está limitado a este destino. **Não mudar simplesmente a flag para true.**
- O gateway e a VPS não são acessíveis diretamente por esta alteração no GitHub; este ficheiro não efetua pagamentos.

## Condições para executar
1. Validar o endereço com `validateaddress` no Core de pagamentos (sem revelar credenciais).
2. Estabelecer restrição de execução **no servidor de pagamentos**, para permitir apenas este endereço e valor 10, e no máximo um novo `request_id`; rejeitar outros pedidos antes de `sendtoaddress`.
3. Exigir reserva PostgreSQL ativa vinculada ao SHA-256 deste endereço e impedir repetição através do diário SQLite existente.
4. Executar o pedido privado do operador, confirmar resposta `success:true` com TXID hexadecimal de 64 caracteres e confirmar o estado do diário.
5. Desativar imediatamente o percurso de pagamento, sem desbloquear o faucet público. Se a resposta for incerta, **não repetir o pagamento**; reconciliar o `request_id` primeiro.

**Não registar chaves de API, credenciais RPC, WIF ou seed neste documento.**
