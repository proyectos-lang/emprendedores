-- ============================================================================
-- Migracion 026 (reparacion): recalcular saldos de caja y cuentas
-- ============================================================================
-- Repara el descuadre historico causado por ventas eliminadas cuyo
-- movimiento de dinero SI se borro, pero dejo el `saldo_resultante` de los
-- movimientos POSTERIORES sin recalcular. Efecto: el saldo corriente de la
-- caja (y la cadena de saldos de las cuentas) quedaba inflado con el dinero
-- de la venta ya borrada.
--
-- El codigo (lib/services) ya recalcula estos saldos al eliminar una venta
-- de aqui en adelante. Este script corrige lo que ya estaba descuadrado.
--
-- Recalcula acumulando el `monto` con su signo, en orden cronologico:
--   - caja_chica_movimientos.monto ya viene con signo (+ entrada / - salida).
--   - cuenta_movimientos.monto es positivo; el signo lo da `tipo`.
--
-- Idempotente: seguro de re-ejecutar (si ya cuadra, no cambia nada).
-- ============================================================================

-- ---------- Caja chica: recalcular saldo_resultante por sesion ----------
WITH recomputado AS (
  SELECT
    id,
    SUM(monto) OVER (
      PARTITION BY sesion_id
      ORDER BY created_at ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS nuevo_saldo
  FROM emprendedores.caja_chica_movimientos
  WHERE sesion_id IS NOT NULL
)
UPDATE emprendedores.caja_chica_movimientos m
SET saldo_resultante = ROUND(r.nuevo_saldo, 2)
FROM recomputado r
WHERE r.id = m.id
  AND ROUND(m.saldo_resultante, 2) <> ROUND(r.nuevo_saldo, 2);

-- ---------- Cuentas bancarias: recalcular saldo_resultante por cuenta ----------
WITH recomputado AS (
  SELECT
    id,
    cuenta_id,
    SUM(CASE WHEN tipo = 'Ingreso' THEN monto ELSE -monto END) OVER (
      PARTITION BY cuenta_id
      ORDER BY fecha ASC, id ASC
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS nuevo_saldo
  FROM emprendedores.cuenta_movimientos
)
UPDATE emprendedores.cuenta_movimientos m
SET saldo_resultante = ROUND(r.nuevo_saldo, 2)
FROM recomputado r
WHERE r.id = m.id
  AND ROUND(m.saldo_resultante, 2) <> ROUND(r.nuevo_saldo, 2);

-- ---------- Cuentas: sincronizar el saldo cacheado con el ultimo movimiento ----------
WITH ultimo AS (
  SELECT DISTINCT ON (cuenta_id)
    cuenta_id, saldo_resultante
  FROM emprendedores.cuenta_movimientos
  ORDER BY cuenta_id, fecha DESC, id DESC
)
UPDATE emprendedores.cuentas_config c
SET saldo = ROUND(u.saldo_resultante, 2)
FROM ultimo u
WHERE u.cuenta_id = c.id
  AND ROUND(c.saldo, 2) <> ROUND(u.saldo_resultante, 2);
