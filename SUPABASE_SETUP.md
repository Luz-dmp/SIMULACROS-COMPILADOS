# Catalyst Education: configuración de backend

## Estado y arquitectura

El proyecto de origen era una aplicación estática. Este cambio añade una integración preparada para Supabase:

- **Auth:** acceso por correo y contraseña, cierre de sesión, invitaciones de cuentas y recuperación de acceso. Supabase Auth mantiene los hashes; Catalyst nunca recibe ni persiste contraseñas.
- **Postgres + RLS:** perfiles, asignaciones de áreas, documentos, preguntas/clasificaciones, compilaciones e historial.
- **Storage privado:** archivos DOCX originales, instantáneas JSON y PDF generados. Los PDF se conservan durante 15 días; las compilaciones y sus preguntas se mantienen después de la caducidad.
- **Edge Function `admin-users`:** las operaciones administrativas verifican token y perfil activo en el servidor y usan claves privilegiadas exclusivamente dentro de la función.

Se eligió Supabase frente a un backend propio porque esta aplicación no tiene servidor ni gestor de dependencias: Auth, Postgres, almacenamiento privado, RLS y funciones gestionadas reducen el código operativo que habría que mantener. Un backend propio permitiría más control, pero obligaría a desplegar y parchear API, sesiones, base de datos, almacenamiento, correo, copias de seguridad y controles de acceso.

**Usa el proyecto Supabase existente; no crees otro.** La copia local inspeccionada contiene una configuración pública de frontend, pero no se verificó a qué proyecto apunta ni si es un entorno de pruebas. No la uses para pruebas hasta confirmar independientemente la identidad y el carácter no productivo del proyecto. Sin migraciones, SMTP y Edge Function configurados no hay integración operativa ni pruebas de autorización remota. La aplicación falla cerrada si falta la configuración o Supabase.

La migración también impide que un tutor, tras perder la asignación de un área, acceda a originales o compilaciones que contienen preguntas de esa área. La metadata documental no puede usarse para cambiar el propietario, las áreas o la ruta de un archivo. El tutor puede guardar una corrección de área, pero no editar el contenido original ni el nivel de confianza de clasificación.

## PDFs temporales y limpieza programada

Los flujos de simulacro, compilado y mini-simulacro generan el PDF en el navegador, lo descargan localmente y suben una copia al bucket privado `catalyst-private`. La migración `20261024113000_harden_generated_pdf_access_and_cleanup.sql` restringe las cargas `.pdf` a rutas asociadas a una compilación propia, existente y autorizada; deja intacta la política necesaria para cargas Word/JSON. La lectura de PDFs queda limitada a su propietario autorizado y a administradores activos. Las filas de compilación conservan su configuración e IDs de preguntas después de la caducidad; la limpieza únicamente retira la ruta/fecha del PDF y el evento `pdf.generated` asociado.

La migración core deja intacta una tabla `public.profiles` existente y valida sus columnas, restricciones esenciales, valores predeterminados y clave foránea antes de continuar; si no coinciden, falla en vez de adaptar o sobrescribir perfiles. Según el estado remoto reportado para el proyecto, `profiles` y `roles` ya existen, las demás tablas Catalyst todavía no y las cinco migraciones siguen pendientes. Ese estado fue informado por el operador y no se verificó desde este entorno. La migración de hardening también valida el esquema Catalyst esperado, bucket privado, funciones de autorización, `pgcrypto`, Vault y secretos; esos preflights no sustituyen la revisión del historial ni de las políticas remotas existentes.

**No ejecutes `supabase db push` a ciegas.** El directorio contiene cinco migraciones: core `20261023173300`, compatibilidad Auth `20261023211900`, retención `20261024110000`, preparación de extensiones `20261024110100` y hardening `20261024113000`. La migración de extensiones no programa tareas ni envía solicitudes. La tarea solo se programa al final de la migración de hardening, que usa firmas HMAC de corta duración.

Para activar la retención, primero confirma con la CLI que las cinco migraciones esperadas siguen pendientes y que no hay otros cambios concurrentes. Si el preflight de `public.profiles` informa una incompatibilidad, detente y revisa el esquema antes de continuar; no borres ni recrees perfiles.

1. Confirma que el proyecto enlazado es el proyecto Catalyst correcto. Si aún no enlazaste la CLI, hazlo primero:

   ```powershell
   npx supabase login
   npx supabase link --project-ref <project-ref>
   ```

   Configura el secreto de la función:

   ```powershell
   npx supabase secrets set CATALYST_PDF_CLEANUP_SECRET="<secreto-aleatorio-largo>" --project-ref <project-ref>
   ```

   Usa un secreto aleatorio nuevo, no una clave de Supabase. La función usa el valor para verificar una firma HMAC; no lo recibe en las cabeceras de `pg_net`.

2. En **Dashboard → Vault**, crea estos tres secretos, con los nombres exactos:

   - `catalyst_supabase_url`: URL del proyecto Supabase.
   - `catalyst_publishable_key`: clave publishable (o legacy `anon`) del proyecto.
   - `catalyst_pdf_cleanup_secret`: el mismo secreto aleatorio configurado en el paso 1.

   No guardes la clave `service_role` en Vault para este trabajo ni en el navegador.

3. Despliega la función después de configurar secretos:

   ```powershell
   npx supabase functions deploy cleanup-generated-pdfs --project-ref <project-ref>
   ```

4. Cuando la función y los secretos estén configurados, confirma el estado y aplica las migraciones pendientes:

   ```powershell
   npx supabase migration list --project-ref <project-ref>
   npx supabase db push --project-ref <project-ref>
   ```

   Con el estado reportado de las cinco pendientes, `db push` las ejecutará cronológicamente. `20261024110100` instala únicamente `pg_cron` y `pg_net`; no programa ninguna tarea. `20261024113000` programa el cron con HMAC como último paso. Si la lista no coincide, no ejecutes `db push` hasta entender las diferencias. No marques migraciones como aplicadas sin ejecutar su contenido.

   La migración de hardening programa `catalyst-generated-pdf-retention` cada 15 minutos y envía solo una marca de tiempo y una firma HMAC válida por cinco minutos. El bearer persistente no se incluye en la solicitud nueva encolada por `pg_net`. El mismo secreto aleatorio debe estar configurado en Vault y en el entorno de la Edge Function.

5. Publica también los cambios estáticos del proyecto web (`index.html`, `js/`, `css/` y el bundle/licencia de PDF) en el hosting de Catalyst; los comandos anteriores solo activan Supabase.

La función procesa lotes de hasta 100 PDFs de antigüedad igual o superior a 15 días. Antes de borrar comprueba la compilación propietaria, las rutas fuente/procesadas de `documents`, todos los eventos que referencian la ruta y el periodo de retención. Si una consulta falla o encuentra referencias inconsistentes, conserva el objeto y los registros para reintentar y devuelve HTTP 500 si hubo fallos (HTTP 200 solo si el lote terminó sin errores). Nunca elimina filas de `compilations`, documentos, preguntas, usuarios, perfiles ni movimientos ajenos a `pdf.generated`. Esta lista de dependencias se basa en el esquema local conocido; como el esquema remoto no se inspeccionó, antes de activar hay que comprobar si existen otras tablas, triggers o procesos que referencien las rutas de Storage.

## Variables y claves

1. En el Dashboard del proyecto existente, abre **Project Settings → API** (en algunas versiones aparece como **Settings → API Keys**) y copia el **Project URL** y la clave **publishable**; también se admite la clave pública legacy `anon`.
2. En este equipo, pega esos dos valores en `js/backend-config.js`: URL en `supabaseUrl` y clave pública en `supabaseAnonKey`. La clave publishable/anon está diseñada para uso en frontend y solo es segura junto con RLS. **No pongas aquí una `secret`/`service_role` key ni la compartas en el chat.**
3. El **Project ref/ID** se encuentra en **Project Settings → General** y se usa para enlazar la CLI. No es una clave. El `project_id = "catalyst-education"` de `supabase/config.toml` es solo el nombre local del proyecto CLI; no confirma ni identifica tu proyecto remoto.
4. Configura `CATALYST_APP_ORIGINS` en los secretos de la Edge Function como una lista separada por comas con los orígenes exactos (protocolo, host y puerto, sin ruta ni barra final). Para probar Catalyst solo desde el servidor local indicado, el valor exacto es `http://127.0.0.1:3000`. Si también se usa `http://localhost:3000` o un dominio publicado, cada origen debe añadirse por separado; `localhost` y `127.0.0.1` son distintos. Incluye únicamente orígenes de confianza.
5. Las funciones usan las claves `SUPABASE_PUBLISHABLE_KEYS` y `SUPABASE_SECRET_KEYS` que Supabase inyecta; también admiten las variables legacy `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. La clave secreta nunca se entrega al navegador.

El archivo `supabase/functions/.env.example` solo documenta orígenes locales; crea `supabase/functions/.env` para desarrollo local y **no lo compartas ni lo subas**. `.gitignore` excluye ese archivo y otros `.env`. El código local de `admin-users` usa el mismo generador de encabezados para `OPTIONS` y para respuestas `POST`: solo refleja una coincidencia exacta de `CATALYST_APP_ORIGINS`, y omite los encabezados de autorización CORS para orígenes no permitidos o el origen opaco literal `null`. La lista local no configura los secretos de la función ya desplegada.

## Aplicación de la base de datos

El código de Catalyst espera `public.profiles(id, full_name, role, is_active)` y `public.user_areas(user_id, area_code)`. El correo se consulta en Supabase Auth; no hace falta una columna `email` en `profiles`. Los únicos roles de aplicación son `admin` y `tutor`. El trigger de alta siempre crea una cuenta `tutor` inactiva, ignora cualquier rol enviado en metadata y no convierte la tabla legacy `public.roles` en una tabla de perfiles.

El error `relation "public.profiles" does not exist` confirma que el trigger remoto está desincronizado con Catalyst: su función `handle_new_user()` intenta escribir en una tabla ausente y con columnas/rol (`email`, `student`) que no corresponden al esquema de la aplicación. La migración de compatibilidad reemplaza ese handler por uno alineado con Catalyst y conserva el trigger existente. La función usa `ON CONFLICT DO NOTHING` para que también sea compatible con el trigger adicional que instala la migración core.

Antes de cambiar datos, confirma en el Dashboard que la base de datos es el proyecto existente y revisa **Database → Migrations**/el historial. Exporta una copia de seguridad antes de modificar un proyecto con datos. No ejecutes el archivo inicial desde SQL Editor si ya existen tablas Catalyst; primero inspecciona los conflictos.

Preflight de nombres de tablas que crea la migración core (no incluye ni modifica la tabla legacy `roles`):

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in ('profiles', 'user_areas', 'documents', 'questions',
                     'compilations', 'operation_logs')
order by table_name;
```

Si la consulta devuelve alguna tabla y el historial no confirma que sea exactamente la versión Catalyst esperada, no ejecutes la core hasta revisar su esquema y los datos. La core usa `CREATE TABLE` normal para esas entidades; no borra tablas, pero falla ante nombres ya ocupados para evitar sobrescribirlas.

Desde PowerShell, inicia sesión en la CLI y enlázala al **Project ref** de tu proyecto existente:

```powershell
npx --yes supabase login
npx --yes supabase link --project-ref <PROJECT_REF>
npx --yes supabase migration list
```

`supabase migration list` es una consulta de estado; no continúes con `db push` sin revisar todas las migraciones pendientes y el esquema remoto. En una base vacía para Catalyst, la core `20261023173300_catalyst_core.sql` crea las tablas, políticas RLS, almacenamiento y funciones administrativas; la migración `20261023211900_auth_profile_trigger_compat.sql` ajusta el trigger legacy. Si el historial dice que la core ya está aplicada pero `public.profiles` no existe, **detente**: el estado es inconsistente y la migración de compatibilidad abortará de forma segura. No marques migraciones como aplicadas ni reapliques el archivo inicial a ciegas; primero se requiere revisar qué objetos existen y preparar una reparación incremental específica.

Si usas SQL Editor en vez de CLI, inspecciona antes el historial y los nombres de tablas. Solo si confirmas que la core de Catalyst no se ha aplicado y no hay tablas Catalyst en conflicto, ejecuta ambos archivos completos en este orden: `supabase/migrations/20261023173300_catalyst_core.sql` y después `supabase/migrations/20261023211900_auth_profile_trigger_compat.sql`. La core incluye las políticas RLS, el bucket privado de 50 MiB y funciones transaccionales para evitar que se elimine el último administrador activo. No ejecutes únicamente el script de compatibilidad: requiere el esquema core.

## Primer administrador

No existe un perfil administrador predefinido. Después de activar la migración:

1. Si todavía no existe una cuenta Auth para la persona administradora, invítala desde **Supabase Dashboard → Authentication → Users**. El trigger crea un perfil tutor inactivo por defecto.
2. Obtén el ID real de esa cuenta:

```sql
select id, email from auth.users where email = 'admin@tu-dominio.org';
```

3. Desde el SQL Editor, con privilegios de propietario, activa solo esa cuenta y asígnale el rol:

```sql
begin;
update public.profiles
set full_name = 'Administración Catalyst', role = 'admin', is_active = true
where id = '<UUID_REAL_DE_AUTH_USERS>';
insert into public.user_areas (user_id, area_code) values
  ('<UUID_REAL_DE_AUTH_USERS>', 'Mat'),
  ('<UUID_REAL_DE_AUTH_USERS>', 'Lec'),
  ('<UUID_REAL_DE_AUTH_USERS>', 'Soc'),
  ('<UUID_REAL_DE_AUTH_USERS>', 'Nat'),
  ('<UUID_REAL_DE_AUTH_USERS>', 'Ing')
on conflict do nothing;
commit;
```

Verifica que el `UPDATE` haya afectado exactamente una fila y que el correo pertenezca al administrador responsable. No habilites sign-up público; las cuentas posteriores se invitan desde el panel.

Si la cuenta Auth ya existía antes de instalar la migración, comprueba primero si tiene fila en `public.profiles`: el trigger no crea perfiles retroactivamente. Si no tiene, verifica el UUID/correo de la persona administradora y crea solo ese perfil manualmente, como propietario:

```sql
insert into public.profiles (id, full_name, role, is_active)
select id, 'Administración Catalyst', 'admin', true
from auth.users
where id = '<UUID_REAL_VERIFICADO>';
```

Confirma que la consulta insertó exactamente una fila. Asigna las áreas administrativas con el bloque `insert into public.user_areas` anterior. No otorgues rol de administrador desde el navegador.

## Auth, correo y recuperación

- Mantén confirmación de correo habilitada.
- Configura un proveedor SMTP propio en **Authentication → SMTP Settings** para invitaciones y recuperación. El SMTP de prueba tiene límites y no es una opción de producción.
- En **Authentication → URL Configuration**, establece el sitio y permite las URLs de redirección del origen local y del dominio HTTPS de despliegue.
- Añade factores MFA a las cuentas administrativas según la política de la organización.
- El botón de recuperación envía un enlace mediante Auth. La vista de retorno acepta la nueva contraseña (mínimo 12 caracteres en el formulario).

## Funciones Edge

Despliega `admin-users` y limita su origen a los dominios exactos de la plataforma:

```powershell
npx supabase secrets set CATALYST_APP_ORIGINS="http://localhost:5500,https://catalyst.example.org" --project-ref <project-ref>
npx supabase functions deploy admin-users --project-ref <project-ref>
```

No configures `verify_jwt = false`. La función verifica el JWT, consulta en servidor el rol/estado actual del llamante, y solo entonces permite invitar usuarios, cambiar áreas/roles/estado o solicitar un correo de recuperación. Los roles y áreas no se aceptan como autoridad desde datos editables del navegador.

`admin-users` crea la invitación de Auth y configura el perfil/áreas mediante `public.catalyst_admin_configure_user`; las ediciones usan esa misma RPC y la activación usa `public.catalyst_admin_set_user_active`. La función obtiene primero la clave privada de `SUPABASE_SECRET_KEYS` (la entrada `default`) y acepta `SUPABASE_SERVICE_ROLE_KEY` como alternativa legacy; ambas permanecen solo en el servidor y nunca deben colocarse en `js/backend-config.js`. Si falla la configuración después de enviar una invitación, la función intenta eliminar la cuenta recién creada. Si esa compensación también falla, informa HTTP 207 y deja el detalle no secreto en el historial. El panel permite reintentar la configuración registrada o cancelar la invitación únicamente mientras el perfil conserve su estado inicial seguro; si no, requiere revisión manual. El perfil que crea el trigger es `tutor` e inactivo por defecto, así que una cuenta pendiente no adquiere acceso a Catalyst. Los estados parciales se guardan como `status = 'failure'` por la restricción actual de `operation_logs`, y se distinguen con `details.outcome = 'partial'`; las operaciones exitosas y fallidas también incluyen su resultado explícito.

**Límite de integridad del historial:** la política RLS actual permite que cualquier usuario activo inserte filas en `operation_logs` atribuidas a sí mismo. La función administrativa solo acepta como evidencia de recuperación filas cuyo autor tenga perfil de administrador, pero el historial general aún puede recibir eventos falsos atribuidos al propio usuario; no lo trates como registro forense inmutable. Esta revisión no cambió RLS. Antes de depender del historial como evidencia autoritativa, diseña y valida una migración que limite las operaciones administrativas a la función de servidor y conserve los eventos de cliente estrictamente necesarios.

Desactivar un perfil bloquea por RLS las operaciones de negocio sobre documentos, preguntas, compilaciones, Storage e historial. No invalida por sí solo los JWT ya emitidos ni elimina inmediatamente la sesión de Auth; la interfaz vuelve a validar el perfil al recuperar el foco y cada minuto, y cierra la sesión al detectar la inactivación. Las políticas actuales permiten que cada cuenta lea su propia fila de perfil y sus áreas incluso inactiva, pero no conceden escritura en esas tablas; no equivalen a acceso a documentos u otras operaciones protegidas. Valida esta distinción en el entorno de pruebas y exige `is_active` en cualquier nueva política de datos protegidos.

El archivo `supabase/functions/.env.example` es solo una plantilla para pruebas locales: añade los orígenes locales que realmente uses, y configura `CATALYST_APP_ORIGINS` también como secreto de la función desplegada con los orígenes HTTPS exactos. Sin el secreto remoto configurado, la función rechaza las solicitudes de navegador; el estado de los secretos remotos no se puede inferir del archivo de ejemplo.

## Ejecución y despliegue

- Sirve `simulacro-web` por HTTP local (por ejemplo, con la extensión Live Server de VS Code); no abras `index.html` como `file://`.
- Configura `js/backend-config.js`, Auth URLs y `CATALYST_APP_ORIGINS` para ese origen.
- Para producción está preparado el despliegue estático en **Cloudflare Pages**: crea un proyecto Pages, carga/conecta la carpeta `simulacro-web` como raíz, deja vacío el comando de build y publica esa misma carpeta como directorio de salida. El archivo `_headers` establece cabeceras de seguridad para las respuestas estáticas.
- Añade el dominio HTTPS de Pages a **Authentication → URL Configuration** y a `CATALYST_APP_ORIGINS`; confirma que las rutas de recuperación/invitación vuelvan a `/`. Verifica después la carga del SDK y las peticiones a Supabase desde el dominio desplegado.
- Si usas Pages con Git, el repositorio aún debe crearse/conectarse: esta copia de trabajo no tiene repositorio Git remoto ni pipeline de despliegue. No se ha publicado nada en internet.
- Para Supabase local hace falta Docker Engine/Desktop. En el entorno de desarrollo no se encontraron Docker ni Podman, por lo que no se pudo levantar el stack local; instalar Docker Desktop puede requerir permisos de administrador y reinicio, y no se ha hecho.

## Datos guardados y recuperación

- `profiles`, `user_areas`, `documents`, `questions`, `compilations` y `operation_logs` son compartidos en Postgres.
- DOCX original y extracción serializada están en el bucket privado `catalyst-private`. La clasificación/corrección estructurada está en la tabla de preguntas. Las imágenes extraídas se convierten a Data URL en la extracción para que sobrevivan al cierre de la sesión.
- Las compilaciones guardan configuración y referencias a preguntas. El flujo actual sigue usando el diálogo de impresión del navegador: **el PDF impreso no se captura ni se sube automáticamente**, y no hay todavía una acción de restaurar/abrir una compilación guardada en la interfaz.
- Las preferencias visuales no críticas pueden seguir en `localStorage`. El antiguo perfil de demostración, biblioteca e historial locales se ignoran y no se migran automáticamente.
- Configura y prueba las copias automáticas de la base de datos disponibles en tu plan. Para archivos, establece un proceso adicional de exportación del bucket privado; una copia de Postgres por sí sola no contiene los DOCX. Ensaya una restauración antes de poner datos reales.

## Configuración pendiente para validar el proyecto existente

La configuración pública de `js/backend-config.js` está presente, pero su proyecto de destino no se verificó y no se considera un entorno de prueba. También falta autenticar la Supabase CLI en esta máquina: la consulta de proyectos devolvió `Access token not provided`. No se debe pegar un token de CLI ni una clave secreta en el código o en el chat.

Para continuar sin crear otro proyecto, el responsable del proyecto debe:

1. Confirmar que `supabaseUrl` y `supabaseAnonKey` identifican el proyecto de pruebas autorizado; si no, configurar esos valores localmente desde **Project Settings → API**. La clave publishable/anon se envía mediante el cliente oficial de Supabase; `functions.invoke` adjunta la sesión JWT actual como autorización. No es una autorización confiable por sí sola: la función vuelve a validar el JWT y el perfil administrador activo.
2. Ejecutar `npx --yes supabase login` en PowerShell y autorizar la CLI en el navegador.
3. Proporcionar el **Project ref** (identificador no secreto de Project Settings → General) para ejecutar `supabase link` y comprobar el historial remoto.
4. Confirmar que la cuenta/proyecto tiene acceso a ejecutar migraciones y desplegar Edge Functions. Configurar SMTP y los orígenes Auth siguiendo las secciones anteriores.

No se ha cambiado ningún dato del proyecto remoto, porque no hay sesión CLI autorizada ni se ha identificado un Project ref. No se ha aplicado la migración, desplegado la función ni publicado Catalyst.

## Pruebas que todavía requieren el proyecto real

Después de configurar el proyecto, prueba inicio/cierre/reinicio de sesión, invitación y confirmación de correo, restablecimiento de contraseña, bloqueo de cuenta inactiva, manipulación directa de rol/área contra RLS, lectura de datos entre dos sesiones, carga DOCX con imágenes, reclasificación, compilación y la recuperación desde una segunda sesión. Hasta ejecutar esas pruebas en el proyecto remoto no se puede certificar el despliegue ni la autorización real. La validación del PDF debe hacerse imprimiendo un archivo real y comparándolo visualmente con la plantilla aprobada.

### Verificación específica de alta e inicio de sesión

1. Después de aplicar las migraciones, confirma en SQL Editor que existe el handler `on_auth_user_created` como `AFTER INSERT` sobre `auth.users` y que llama a `public.handle_new_user()`. Comprueba también que `profiles` y `user_areas` tienen RLS activo:

```sql
select t.tgname, pg_get_triggerdef(t.oid) as trigger_definition,
       p.proname as function_name
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
join pg_proc p on p.oid = t.tgfoid
where n.nspname = 'auth' and c.relname = 'users'
  and not t.tgisinternal
  and t.tgname = 'on_auth_user_created';

select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname in ('profiles', 'user_areas');
```

2. Invita un usuario desde Catalyst como administrador. Auth debe enviar la invitación; después de la operación completa, `public.profiles` debe tener el mismo UUID de `auth.users`, el rol y las áreas solicitadas, e `is_active = false`. El trigger crea inicialmente `tutor` inactivo; la función aplica la configuración solicitada con `catalyst_admin_configure_user`, nunca desde metadata confiable del navegador.
3. Comprueba el correo de invitación, establece la contraseña y confirma que aún no puede iniciar sesión mientras siga inactivo. Activa el usuario desde Catalyst y valida que rol/áreas aparecen correctamente.
4. En un entorno desechable, comprueba edición, asignación de áreas, desactivación/activación, correo de recuperación e historial. Con una sesión del tutor ya abierta, desactívalo y prueba lecturas y escrituras protegidas: deben rechazarse por RLS/estado activo aunque el JWT siga vigente; la sesión puede persistir hasta la siguiente comprobación de la interfaz.
5. La prueba unitaria local cubre la configuración fallida seguida de compensación Auth fallida (resultado parcial) y la alternativa de compensación exitosa. Para validar la ruta completa, usa solo un stack local o proyecto de pruebas verificado y provoca fallos únicamente mediante inyección de dependencias o configuración de prueba; no alteres producción.

Antes de aplicar la migración modificada en un proyecto que ya tenga esta versión instalada, crea una copia de seguridad de la base de datos y prepara una migración incremental; no vuelvas a ejecutar ciegamente un archivo inicial sobre un proyecto con tablas existentes.
