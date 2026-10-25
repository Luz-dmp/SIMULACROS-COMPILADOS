/* ============================================================
   CATALYST · Generador de simulacros
   Configuración editable (colores, textos de portada, geometría)
   ============================================================ */
window.CATALYST_CONFIG = {

  /* Identidad visual centralizada por área */
  areas: {
    Mat: { name: 'MATEMÁTICAS', short: 'MAT', A: '#6AA8F5', B: '#9A74F0', accent: '#6AA8F5', icon: '∑' },
    Lec: { name: 'LECTURA CRÍTICA', short: 'LEC', A: '#F7A1B4', B: '#D9506B', accent: '#D9506B', icon: '✎' },
    Soc: { name: 'CIENCIAS SOCIALES', short: 'SOC', A: '#F68B1F', B: '#FBC02D', accent: '#F68B1F', icon: '◌' },
    Nat: { name: 'CIENCIAS NATURALES', short: 'NAT', A: '#5BC236', B: '#C5E04A', accent: '#5BC236', icon: '✦' },
    Ing: { name: 'INGLÉS', short: 'ING', A: '#9D7BE0', B: '#F7A6EA', accent: '#9D7BE0', icon: 'A' }
  },

  /* Cómo se reconoce el título de cada área en el Word (sin tildes, minúsculas) */
  areaAliases: {
    'matematicas': 'Mat',
    'matematica': 'Mat',
    'lectura critica': 'Lec',
    'lectura': 'Lec',
    'lenguaje': 'Lec',
    'sociales': 'Soc',
    'ciencias sociales': 'Soc',
    'ciencias sociales y ciudadanas': 'Soc',
    'sociales y ciudadanas': 'Soc',
    'competencias ciudadanas': 'Soc',
    'ciencias naturales': 'Nat',
    'naturales': 'Nat',
    'biologia': 'Nat',
    'fisica': 'Nat',
    'quimica': 'Nat',
    'prueba de ingles': 'Ing',
    'ingles': 'Ing',
    'english': 'Ing',
    'english test': 'Ing'
  },

  roles: {
    tutor: { label: 'Tutor', description: 'Puede crear materiales de áreas autorizadas.' },
    admin: { label: 'Administrativo', description: 'Acceso a todas las áreas y gestión académica.' }
  },

  /* Marca de agua (opcional: puedes reemplazar assets/marca-agua.png) */
  watermark: { file: 'assets/marca-agua.png', opacity: 1 },

  /* Textos de la portada */
  cover: {
    codePattern: 'CAT · AXIS · 0{n}',
    sessionNames: { 1: 'PRIMERA SESIÓN', 2: 'SEGUNDA SESIÓN' },
    centralImages: { 1: 'assets/imagen-central.png', 2: 'assets/imagen-central2.png' },
    qrImage: 'assets/qr.png',
    tags: { horas: '4 HORAS', extra: 'ESTRATEGIA' },
    tenEnCuenta: [
      'No se permite el uso de celulares u otros dispositivos electrónicos.',
      'No uses calculadora salvo indicación.',
      'Mantén el orden del cuadernillo.'
    ],
    comoRealizar: [
      'Responde una sola opción por pregunta.',
      'Administra el tiempo como en el ICFES.',
      'Marca tus respuestas correctamente.',
      'Revisa al finalizar.'
    ],
    contactoA: ['@catalyst.education', '+57 324 1249 049'],
    contactoB: ['@catalyst.education', 'Catalyst Education']
  }
};
