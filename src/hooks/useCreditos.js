import { useState, useEffect, useCallback } from 'react'
import {
  getCartera,
  getCreditoDetalle,
  getCronograma,
} from '../services/svc_creditos.js'

export function useCartera(pkasesor, periodomes) {
  const [cartera, setCartera] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!pkasesor || !periodomes) return
    setLoading(true)
    setError(null)
    try {
      setCartera(await getCartera(pkasesor, periodomes))
    } catch (err) {
      setError(err.response?.data?.detail || 'Error al cargar la cartera.')
    } finally {
      setLoading(false)
    }
  }, [pkasesor, periodomes])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { cartera, loading, error, recargar: cargar }
}

export function useCreditoDetalle(codcuentacredito) {
  const [detalle, setDetalle] = useState(null)
  const [cronograma, setCronograma] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const cargar = useCallback(async () => {
    if (!codcuentacredito) return
    setLoading(true)
    setError(null)
    try {
      const [det, cron] = await Promise.all([
        getCreditoDetalle(codcuentacredito),
        getCronograma(codcuentacredito),
      ])
      setDetalle(det)
      setCronograma(cron)
    } catch (err) {
      setError(
        err.response?.status === 404
          ? 'El credito no existe.'
          : 'Error al cargar el credito.',
      )
    } finally {
      setLoading(false)
    }
  }, [codcuentacredito])

  useEffect(() => {
    cargar()
  }, [cargar])

  return { detalle, cronograma, loading, error, recargar: cargar }
}

export default useCartera
