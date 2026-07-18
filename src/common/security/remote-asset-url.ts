export function isAllowedRemoteAssetUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }

  if (trimmed.startsWith('data:')) {
    // Solo se permiten imagenes embebidas. Permitir cualquier esquema data:
    // convertia al renderer de PDF en un consumidor de contenido arbitrario.
    return /^data:image\/(?:png|jpeg);base64,[a-z0-9+/=\s]+$/i.test(trimmed);
  }

  // El renderer de PDF no descarga recursos por red. Una allowlist de hosts
  // no protege frente a rebinding DNS ni a una configuracion equivocada; usar
  // datos embebidos elimina por completo esta superficie SSRF.
  return false;
}
