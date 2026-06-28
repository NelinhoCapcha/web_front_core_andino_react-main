import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Ban, Gavel, History, Plus, Trash2, X } from 'lucide-react'
import { useCreditoDetalle } from '../hooks/useCreditos.js'
import {
  useGestiones,
  useHistorialEstados,
} from '../hooks/useRecuperaciones.js'
import { useAuth } from '../hooks/useAuth.js'
import {
  BANDA_INFO,
  UMBRAL_CASTIGO,
  UMBRAL_JUDICIAL,
  puede,
} from '../utils/permisos.js'
import {
  castigarCredito,
  notificarCambioMora,
  pasarJudicial,
} from '../services/svc_recuperaciones.js'
import TablaCronograma from '../components/ui/TablaCronograma.jsx'
import Loader from '../components/ui/Loader.jsx'
import { fecha, money, num, pct } from '../utils/format.js'

const TIPOS_GESTION = [
  { value: 'LLAM', label: 'Llamada' },
  { value: 'VISI', label: 'Visita' },
  { value: 'WHATS', label: 'WhatsApp' },
  { value: 'EMAIL', label: 'Email' },
]

const RESULTADOS = ['Contactado', 'No contactado', 'Promesa de pago']

function detalleError(err, fallback) {
  const d = err.response?.data?.detail
  if (typeof d === 'string') return d
  if (d?.error) return d.error
  if (err.response?.status === 403) return 'Acceso no autorizado'
  return fallback
}

function estadoCredito(detalle) {
  if (detalle?.estado_credito) return detalle.estado_credito
  if (detalle?.flagcastigado === 'S') return 'Castigado'
  if (detalle?.flagjudicial === 'S') return 'Judicial'
  return 'Vigente'
}

function EstadoBadge({ estado }) {
  const cls = estado === 'Castigado' ? 'badge--neutral' : estado === 'Judicial' ? 'badge--rojo' : 'badge--verde'
  return <span className={`badge ${cls}`}>{estado}</span>
}

function BandaBadge({ banda }) {
  const info = BANDA_INFO[banda] || { label: banda || '-', color: '#64748b' }
  return (
    <span
      className="badge"
      style={{ background: `${info.color}22`, color: info.color, border: `1px solid ${info.color}55` }}
    >
      {info.label}
    </span>
  )
}

export default function CreditoDetallePage() {
  const { codcuentacredito } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const rol = user?.rol
  const esAsesor = rol === 'asesor'
  const puedeGestionarCobranza = puede(rol, 'gestionar_cobranza')
  const puedeJudicial = puede(rol, 'derivar_judicial')
  const puedeCastigar = puede(rol, 'castigar_credito')
  const puedeVerR2 = esAsesor || puedeGestionarCobranza
  const puedeVerR3 = esAsesor || puedeJudicial || puedeCastigar
  const { detalle, cronograma, loading, error, recargar } =
    useCreditoDetalle(codcuentacredito)
  const { gestiones, loading: loadingGestiones, registrar, eliminar, accionLoading, accionMsg, recargar: recargarGestiones } =
    useGestiones(puedeVerR2 ? codcuentacredito : null)
  const { historial, loading: loadingHistorial, recargar: recargarHistorial } =
    useHistorialEstados(puedeVerR3 ? codcuentacredito : null)
  const [modalGestion, setModalGestion] = useState(false)
  const [aviso, setAviso] = useState(null)
  const [transicion, setTransicion] = useState(null)

  if (loading) {
    return (
      <div className="card">
        <Loader texto="Cargando credito..." />
      </div>
    )
  }

  if (error) {
    return (
      <div>
        <button className="btn btn--ghost" onClick={() => navigate(-1)}>
          &larr; Volver
        </button>
        <div className="alert alert--error" style={{ marginTop: 16 }}>
          {error}
        </div>
      </div>
    )
  }

  if (!detalle) return null

  const estado = estadoCredito(detalle)
  const dias = Number(detalle.diasatrasocredito || 0)
  const bloqueoJudicial =
    estado === 'Judicial' || estado === 'Castigado'
      ? 'El credito ya salio de Vigente'
      : dias < UMBRAL_JUDICIAL
        ? `Requiere >= ${UMBRAL_JUDICIAL} dias de atraso`
        : null
  const bloqueoCastigo =
    estado === 'Castigado'
      ? 'El credito ya esta castigado'
      : dias < UMBRAL_CASTIGO
        ? `Requiere >= ${UMBRAL_CASTIGO} dias de atraso`
        : null

  const filas = [
    ['Cliente', detalle.nomcliente],
    ['Documento', detalle.numerodocumentoidentidad],
    ['Monto aprobado', money(detalle.montoaprobadocredito)],
    ['Nro. de cuotas', num(detalle.nrocuotaaprobado)],
    ['Producto', detalle.desproducto || detalle.destipocredito],
    ['Tasa compensatoria', pct(detalle.tea_aplicada ?? detalle.tasainterescompensatoria)],
    ['Tasa moratoria', pct(detalle.tasa_moratoria)],
    ['Fecha de aprobacion', detalle.fechaaprobacioncredito],
    ['Saldo capital', money(detalle.montosaldocapital)],
    ['Saldo interes', money(detalle.montosaldointeres)],
    ['Saldo mora', money(detalle.montosaldomoratorio)],
    ['Gastos', money(detalle.montosaldogasto)],
    ['Pago pendiente', money(detalle.pago_pendiente ?? detalle.montosaldocliente)],
    ['Dias de atraso', num(detalle.diasatrasocredito)],
  ]

  async function ejecutarTransicion(tipo) {
    const cfg = {
      judicial: {
        fn: pasarJudicial,
        pregunta: `Derivar a cobranza judicial el credito ${detalle.codcuentacredito}?`,
      },
      castigo: {
        fn: castigarCredito,
        pregunta: `Castigar el credito ${detalle.codcuentacredito}?`,
      },
    }[tipo]
    // eslint-disable-next-line no-alert
    if (!window.confirm(cfg.pregunta)) return
    setTransicion(tipo)
    setAviso(null)
    try {
      const res = await cfg.fn(detalle.codcuentacredito)
      setAviso({ tipo: 'ok', texto: `${res.estado} registrado correctamente.` })
      await Promise.all([recargar(), recargarGestiones(), recargarHistorial()])
      notificarCambioMora({ codcuentacredito: detalle.codcuentacredito, estado: res.estado })
    } catch (err) {
      setAviso({ tipo: 'error', texto: detalleError(err, 'No se pudo actualizar el estado del credito.') })
    } finally {
      setTransicion(null)
    }
  }

  async function eliminarGestionCobranza(pkgestion) {
    // eslint-disable-next-line no-alert
    if (!window.confirm('Eliminar esta gestion de cobranza del historial?')) return
    const res = await eliminar(pkgestion)
    if (res) {
      setAviso({ tipo: 'ok', texto: 'Gestion de cobranza eliminada correctamente.' })
    }
  }

  return (
    <div>
      <button className="btn btn--ghost" onClick={() => navigate(-1)}>
        &larr; Volver a cartera
      </button>

      <h1 className="page-title" style={{ marginTop: 16 }}>
        Credito {detalle.codcuentacredito}
      </h1>
      <p className="page-subtitle">Cliente: {detalle.nomcliente}</p>

      {aviso && (
        <div className={`alert ${aviso.tipo === 'ok' ? 'alert--info' : 'alert--error'}`}>
          {aviso.texto}
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h3 style={{ marginTop: 0 }}>Detalle del credito</h3>
          <ul className="detalle-list">
            {filas.map(([k, v]) => (
              <li key={k}>
                <span>{k}</span>
                <span>
                  <strong>{v ?? '-'}</strong>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="card">
          <h3 style={{ marginTop: 0 }}>Cronograma de pagos</h3>
          <TablaCronograma cronograma={cronograma} />
        </div>
      </div>

      {puedeVerR2 && (
      <section className="card" style={{ marginTop: 18 }}>
        <div className="dashboard-card-head">
          <div>
            <h3 style={{ margin: 0 }}>HISTORIAL DE GESTIONES DE COBRANZA</h3>
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              Registro operativo R2 por credito.
            </p>
          </div>
          {puedeGestionarCobranza ? (
            <button className="btn" onClick={() => setModalGestion(true)}>
              <Plus size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Registrar gestion de cobranza
            </button>
          ) : esAsesor ? (
            <span className="badge badge--neutral">Solo lectura</span>
          ) : null}
        </div>

        {accionMsg && !modalGestion && (
          <div className={`alert ${accionMsg.tipo === 'ok' ? 'alert--info' : 'alert--error'}`}>
            {accionMsg.texto}
          </div>
        )}

        {loadingGestiones ? (
          <Loader texto="Cargando gestiones..." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Tipo de gestion</th>
                <th>Resultado</th>
                <th>Comentario</th>
                <th>Usuario</th>
                {puedeGestionarCobranza && <th>Acciones</th>}
              </tr>
            </thead>
            <tbody>
              {gestiones.map((g) => (
                <tr key={g.pkgestion}>
                  <td>{fecha(g.fechagestion)}</td>
                  <td>{g.tipo}</td>
                  <td>{g.resultado || '-'}</td>
                  <td>{g.comentario || '-'}</td>
                  <td>{g.gestor || '-'}</td>
                  {puedeGestionarCobranza && (
                    <td>
                      <button
                        className="btn btn--ghost"
                        disabled={accionLoading}
                        title="Eliminar gestion registrada por error"
                        style={{ padding: '6px 10px', color: '#dc2626' }}
                        onClick={() => eliminarGestionCobranza(g.pkgestion)}
                      >
                        <Trash2 size={14} style={{ verticalAlign: '-2px' }} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {gestiones.length === 0 && (
                <tr>
                  <td colSpan={puedeGestionarCobranza ? 6 : 5} className="page-subtitle" style={{ padding: 18 }}>
                    Sin gestiones registradas para este credito.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      )}

      {puedeVerR3 && (
      <section className="card" style={{ marginTop: 18 }}>
        <div className="dashboard-card-head">
          <div>
            <h3 style={{ margin: 0 }}>GESTION DE ESTADO DEL CREDITO</h3>
            <p className="page-subtitle" style={{ margin: '4px 0 0' }}>
              Estado actual: <EstadoBadge estado={estado} /> · Dias de atraso: <strong>{num(dias)}</strong>
            </p>
          </div>
          {(puedeJudicial || puedeCastigar) && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              className="btn btn--ghost"
              disabled={!puedeJudicial || !!bloqueoJudicial || !!transicion}
              title={!puedeJudicial ? 'Acceso no autorizado' : bloqueoJudicial || 'Enviar a Judicial'}
              onClick={() => ejecutarTransicion('judicial')}
            >
              <Gavel size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Enviar a Judicial
            </button>
            <button
              className="btn btn--ghost"
              disabled={!puedeCastigar || !!bloqueoCastigo || !!transicion}
              title={!puedeCastigar ? 'Acceso no autorizado' : bloqueoCastigo || 'Castigar credito'}
              onClick={() => ejecutarTransicion('castigo')}
            >
              <Ban size={15} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              Castigar Credito
            </button>
          </div>
          )}
        </div>

        <h4 style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
          <History size={16} /> Historial de estados
        </h4>
        {loadingHistorial ? (
          <Loader texto="Cargando historial de estados..." />
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Fecha cambio</th>
                <th>Estado anterior</th>
                <th>Estado nuevo</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {historial.map((h) => (
                <tr key={h.idhistorial}>
                  <td>{fecha(h.fechacambio)}</td>
                  <td>{h.estadoanterior || '-'}</td>
                  <td><EstadoBadge estado={h.estadonuevo} /></td>
                  <td>{h.usuario || '-'}</td>
                </tr>
              ))}
              {historial.length === 0 && (
                <tr>
                  <td colSpan={4} className="page-subtitle" style={{ padding: 18 }}>
                    Sin cambios de estado registrados.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>
      )}

      {modalGestion && puedeGestionarCobranza && (
        <GestionCobranzaModal
          accionLoading={accionLoading}
          accionMsg={accionMsg}
          credito={detalle}
          onClose={() => setModalGestion(false)}
          onGuardar={async (body) => {
            const res = await registrar(body)
            if (res) setModalGestion(false)
          }}
        />
      )}
    </div>
  )
}

function GestionCobranzaModal({ accionLoading, accionMsg, credito, onClose, onGuardar }) {
  const { user } = useAuth()
  const [tipoGestion, setTipoGestion] = useState('LLAM')
  const [resultado, setResultado] = useState('Contactado')
  const [comentario, setComentario] = useState('')

  async function guardar() {
    await onGuardar({
      codtipogestion: tipoGestion,
      resultado,
      comentario: comentario.trim(),
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()} style={{ width: 560 }}>
        <button className="modal-close" onClick={onClose} aria-label="Cerrar">
          <X size={18} />
        </button>
        <h2 style={{ margin: '0 0 4px', fontSize: 19, color: 'var(--c-primary)' }}>
          Registrar gestion de cobranza
        </h2>
        <p className="page-subtitle" style={{ marginTop: 0 }}>
          Credito <strong>{credito.codcuentacredito}</strong> · Usuario <strong>{user?.nombre || user?.codpersonal}</strong>
        </p>

        {accionMsg && (
          <div className={`alert ${accionMsg.tipo === 'ok' ? 'alert--info' : 'alert--error'}`}>
            {accionMsg.texto}
          </div>
        )}

        <div className="form-grid">
          <div className="field">
            <label>Tipo de gestion</label>
            <select value={tipoGestion} onChange={(e) => setTipoGestion(e.target.value)}>
              {TIPOS_GESTION.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Resultado</label>
            <select value={resultado} onChange={(e) => setResultado(e.target.value)}>
              {RESULTADOS.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </select>
          </div>
          <div className="field" style={{ gridColumn: '1 / -1' }}>
            <label>Comentario</label>
            <textarea
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              rows={4}
              style={{ resize: 'vertical', padding: 11, border: '1px solid var(--c-border)', borderRadius: 10, font: 'inherit' }}
              placeholder="Detalle de la llamada, visita o compromiso registrado"
            />
          </div>
        </div>

        <button className="btn" disabled={accionLoading || !comentario.trim()} style={{ marginTop: 14 }} onClick={guardar}>
          {accionLoading ? 'Guardando...' : 'Guardar gestion'}
        </button>
      </div>
    </div>
  )
}
