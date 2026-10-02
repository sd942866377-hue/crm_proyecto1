# Graph Report - crm_proyecto1  (2026-10-02)

## Corpus Check
- Corpus is ~5,641 words - fits in a single context window. You may not need a graph.

## Summary
- 78 nodes · 87 edges · 6 communities
- Extraction: 94% EXTRACTED · 6% INFERRED · 0% AMBIGUOUS · INFERRED: 5 edges (avg confidence: 0.83)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Frontend CRM App
- Database & Storage Layer
- Flask & Telegram Backend
- CRM UI & Project Docs
- Contact Detail & Deals
- Client Rendering & Pagination

## God Nodes (most connected - your core abstractions)
1. `CRM Seguridad App (index.html)` - 6 edges
2. `Contact Detail View (Sarah Johnson / Architectural Ledger)` - 5 edges
3. `registrar_cliente()` - 4 edges
4. `listar_clientes()` - 4 edges
5. `fetchClients()` - 3 edges
6. `renderClients()` - 3 edges
7. `save_cliente()` - 3 edges
8. `get_clientes()` - 3 edges
9. `after_request()` - 3 edges
10. `index()` - 3 edges

## Surprising Connections (you probably didn't know these)
- `CRM Seguridad Project (crm_proyecto1)` --references--> `CRM Seguridad App (index.html)`  [INFERRED]
  README.md → index.html
- `CRM Seguridad Project (crm_proyecto1)` --conceptually_related_to--> `Architectural Ledger CRM App`  [INFERRED]
  README.md → index.html.html
- `CRM Seguridad App (index.html)` --conceptually_related_to--> `Architectural Ledger CRM App`  [INFERRED]
  index.html → index.html.html
- `registrar_cliente()` --calls--> `save_cliente()`  [EXTRACTED]
  main.py → database.py
- `listar_clientes()` --calls--> `get_clientes()`  [EXTRACTED]
  main.py → database.py

## Import Cycles
- None detected.

## Communities (6 total, 0 thin omitted)

### Community 0 - "Frontend CRM App"
Cohesion: 0.06
Nodes (26): accionContactoSelect, archivoOrigenInput, btnNext, btnPrev, clienteInput, clientsList, confettiContainer, contactoObservacionInput (+18 more)

### Community 1 - "Database & Storage Layer"
Cohesion: 0.13
Nodes (6): get_clientes(), init_db(), save_cliente(), index(), listar_clientes(), registrar_cliente()

### Community 2 - "Flask & Telegram Backend"
Cohesion: 0.17
Nodes (3): after_request(), run_telegram_bot(), send_welcome()

### Community 3 - "CRM UI & Project Docs"
Cohesion: 0.33
Nodes (7): CRM Seguridad App (index.html), base_rpmkt Data Table, Client List Tab (Ver Listas), Client Registration Form (CRM Seguridad), Architectural Ledger CRM App, Telegram WebApp SDK Integration, CRM Seguridad Project (crm_proyecto1)

### Community 4 - "Contact Detail & Deals"
Cohesion: 0.60
Nodes (5): Activity Feed Component (Correos, Llamadas, Tareas, Notas, Reuniones), Contact Detail View (Sarah Johnson / Architectural Ledger), Expansión T3 Deal ($15,000 – Discovery stage), Sarah Johnson (Contact – Senior Marketing Manager), TechCorp (Associated Company)

### Community 5 - "Client Rendering & Pagination"
Cohesion: 0.50
Nodes (4): escapeHTML(), fetchClients(), renderClients(), updatePaginationControls()

## Knowledge Gaps
- **31 isolated node(s):** `tabRegistrar`, `tabVerListas`, `contentRegistrar`, `contentVerListas`, `crmForm` (+26 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 53 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `registrar_cliente()` connect `Database & Storage Layer` to `Flask & Telegram Backend`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Why does `listar_clientes()` connect `Database & Storage Layer` to `Flask & Telegram Backend`?**
  _High betweenness centrality (0.017) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `CRM Seguridad App (index.html)` (e.g. with `Architectural Ledger CRM App` and `CRM Seguridad Project (crm_proyecto1)`) actually correct?**
  _`CRM Seguridad App (index.html)` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `tabRegistrar`, `tabVerListas`, `contentRegistrar` to the rest of the system?**
  _31 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Frontend CRM App` be split into smaller, more focused modules?**
  _Cohesion score 0.058823529411764705 - nodes in this community are weakly interconnected._
- **Should `Database & Storage Layer` be split into smaller, more focused modules?**
  _Cohesion score 0.13333333333333333 - nodes in this community are weakly interconnected._