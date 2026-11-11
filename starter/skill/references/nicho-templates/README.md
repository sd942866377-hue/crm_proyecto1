# Nicho templates — plantillas de arranque por giro

Referencia que usas durante `/configurar-mi-chatbot` (y `/re-nichar`) para pre-llenar
`member/config.local.ts` y `member/kb/` según el giro del negocio del miembro. NO copies
estos archivos tal cual — son punto de partida; confirma/ajusta cada dato con el miembro.

## Giros con plantilla dedicada (11)

`barberia` · `coach` · `crm` · `dentista` · `gimnasio` · `hoteleria` · `inmobiliaria` ·
`panaderia` · `restaurante` · `salon` · `tienda`

## Giros nativos SIN plantilla dedicada (3)

`cafeteria`, `clinica` y `spa` son giros **nativos** del bot — `BOT_NICHE` los soporta
completo (panel re-etiquetado, tools propias en `src/niches/<giro>.ts`, tono por defecto,
playbooks de diagnóstico) — pero todavía no tienen un `.md` de plantilla dedicado en esta
carpeta. Para configurarlos, usa el playbook genérico o el de su análogo más cercano:

- **`cafeteria`** ≈ `panaderia.md` / `tienda.md` (consumo rápido, pedido para llevar)
- **`clinica`** ≈ `dentista.md` (agenda de citas por área/médico, sin diagnosticar)
- **`spa`** ≈ `salon.md` (agenda de sesiones con profesional/suite, tono sereno)

No fabriques contenido de negocio para estos tres a partir de este README — si hace falta
una plantilla dedicada para alguno, créala como su propia tarea.

Lista completa de giros soportados: `src/niches/index.ts` (14 packs + `generico` de
fallback).
