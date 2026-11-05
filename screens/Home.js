import { useEffect, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  ImageBackground,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";

import { onAuthStateChanged } from "firebase/auth";

import {
  collection,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig.js";

const TIPOS_FILTRO = [
  "Todos",
  "Médicos",
  "Primeros auxilios",
  "Voluntarios",
  "Rescate",
  "Alimentos",
  "Agua y suministros",
  "Refugio",
];

export default function Home() {
  const [fontsLoaded] = useFonts({
    Lobster: require("../assets/fonts/Lobster-Regular.ttf"),
    Montserrat: require("../assets/fonts/Montserrat-VariableFont_wght.ttf"),
  });

  const [solicitudes, setSolicitudes] = useState([]);
  const [user, setUser] = useState(null);
  const [perfilUsuario, setPerfilUsuario] = useState(null);

  const [modalApoyoVisible, setModalApoyoVisible] = useState(false);
  const [solicitudSeleccionada, setSolicitudSeleccionada] = useState(null);

  const [procesando, setProcesando] = useState(false);

  const [cargando, setCargando] = useState(true);
  const [errorSolicitudes, setErrorSolicitudes] = useState(false);

  const [filtro, setFiltro] = useState("Todos");
  const [verFiltros, setVerFiltros] = useState(false);

  // ==========================================
  // ESCUCHAR SOLICITUDES DE FIRESTORE
  // ==========================================

  useEffect(() => {
    const consulta = query(
      collection(db, "solicitudes"),
      orderBy("fecha", "desc")
    );

    const cancelarEscucha = onSnapshot(
      consulta,
      (resultado) => {
        const lista = resultado.docs.map((documento) => ({
          id: documento.id,
          ...documento.data(),
        }));

        setSolicitudes(lista);
        setErrorSolicitudes(false);
        setCargando(false);
      },
      (error) => {
        console.log("Error al cargar solicitudes:", error);

        setErrorSolicitudes(true);
        setCargando(false);
      }
    );

    return () => cancelarEscucha();
  }, []);

  // ==========================================
  // ESCUCHAR AUTENTICACIÓN
  // ==========================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      if (!currentUser) {
        setPerfilUsuario(null);
      }
    });

    return unsubscribe;
  }, []);

  // ==========================================
  // ESCUCHAR PERFIL DEL USUARIO
  // ==========================================

  useEffect(() => {
    if (!user) {
      setPerfilUsuario(null);
      return;
    }

    const perfilRef = doc(db, "usuarios", user.uid);

    const cancelarEscucha = onSnapshot(
      perfilRef,
      (documento) => {
        if (documento.exists()) {
          setPerfilUsuario({
            id: documento.id,
            ...documento.data(),
          });
        } else {
          setPerfilUsuario(null);
        }
      },
      (error) => {
        console.log("Error al escuchar el perfil:", error);
      }
    );

    return () => cancelarEscucha();
  }, [user]);

  // ==========================================
  // FORMATEAR FECHA
  // ==========================================

  const obtenerFecha = (fecha) => {
    if (!fecha || typeof fecha.toDate !== "function") {
      return "Fecha pendiente";
    }

    return fecha.toDate().toLocaleString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // ==========================================
  // ABRIR MODAL DE CONFIRMACIÓN
  // ==========================================

  const abrirModalApoyo = (solicitud) => {
    if (!user) {
      Alert.alert(
        "Inicia sesión",
        "Debes iniciar sesión para apoyar una solicitud."
      );
      return;
    }

    if (!perfilUsuario) {
      Alert.alert(
        "Perfil no encontrado",
        "No encontramos tu perfil en Firebase. Verifica que exista tu documento en la colección usuarios."
      );
      return;
    }

    if (perfilUsuario.ayudaEnCurso) {
      Alert.alert(
        "Ya tienes una ayuda asignada",
        "Debes cancelar tu apoyo actual antes de aceptar otra solicitud."
      );
      return;
    }

    if (
      solicitud.estado !== "Pendiente" ||
      solicitud.apoyadoPor
    ) {
      Alert.alert(
        "Solicitud no disponible",
        "Esta solicitud ya cuenta con un colaborador o fue atendida."
      );
      return;
    }

    setSolicitudSeleccionada(solicitud);
    setModalApoyoVisible(true);
  };

  // ==========================================
  // ACEPTAR SOLICITUD CON TRANSACCIÓN
  // ==========================================

  const aceptarSolicitud = async () => {
    if (!user || !solicitudSeleccionada || procesando) {
      return;
    }

    setProcesando(true);

    try {
      const usuarioRef = doc(db, "usuarios", user.uid);

      const solicitudRef = doc(
        db,
        "solicitudes",
        solicitudSeleccionada.id
      );

      await runTransaction(db, async (transaction) => {
        // Primero se leen los documentos.
        const usuarioDoc = await transaction.get(usuarioRef);
        const solicitudDoc = await transaction.get(solicitudRef);

        if (!usuarioDoc.exists()) {
          throw new Error("NO_EXISTE_PERFIL");
        }

        if (!solicitudDoc.exists()) {
          throw new Error("SOLICITUD_NO_EXISTE");
        }

        const datosUsuario = usuarioDoc.data();
        const datosSolicitud = solicitudDoc.data();

        // Verificar que el usuario no tenga otra ayuda.
        if (datosUsuario.ayudaEnCurso) {
          throw new Error("USUARIO_OCUPADO");
        }

        // Verificar que la solicitud siga disponible.
        if (
          datosSolicitud.estado !== "Pendiente" ||
          datosSolicitud.apoyadoPor
        ) {
          throw new Error("SOLICITUD_OCUPADA");
        }

        // Asignar la solicitud al usuario.
        transaction.update(solicitudRef, {
          estado: "En proceso",
          apoyadoPor: user.uid,
          apoyadoPorNombre:
            datosUsuario.nombre ||
            user.displayName ||
            "Colaborador",
          fechaApoyo: serverTimestamp(),
        });

        // Actualizar el perfil del usuario.
        transaction.update(usuarioRef, {
          ayudaEnCurso: solicitudSeleccionada.id,
          estadoAyuda: "Ocupado",
          disponible: false,
        });
      });

      setModalApoyoVisible(false);
      setSolicitudSeleccionada(null);

      Alert.alert(
        "¡Gracias por apoyar!",
        "La solicitud quedó asignada a tu usuario. Tu perfil ahora aparece como ocupado."
      );
    } catch (error) {
      console.error("Error al aceptar solicitud:", error);

      if (error.message === "NO_EXISTE_PERFIL") {
        Alert.alert(
          "Perfil no encontrado",
          "No existe tu perfil en la colección usuarios de Firebase."
        );
      } else if (error.message === "SOLICITUD_NO_EXISTE") {
        Alert.alert(
          "Solicitud no encontrada",
          "La solicitud ya no está disponible."
        );
      } else if (error.message === "USUARIO_OCUPADO") {
        Alert.alert(
          "Ya tienes una ayuda en progreso",
          "Debes cancelar tu apoyo actual antes de aceptar otra solicitud."
        );
      } else if (error.message === "SOLICITUD_OCUPADA") {
        Alert.alert(
          "Solicitud no disponible",
          "Otra persona ya aceptó esta solicitud o su estado cambió."
        );
      } else {
        Alert.alert(
          "Error",
          "No se pudo registrar tu apoyo. Revisa los permisos de Firestore."
        );
      }
    } finally {
      setProcesando(false);
    }
  };

  // ==========================================
  // CANCELAR APOYO ACTUAL
  // ==========================================

  const cancelarAyuda = () => {
    if (!user || !perfilUsuario?.ayudaEnCurso) {
      return;
    }

    Alert.alert(
      "Cancelar apoyo",
      "¿Estás seguro de que deseas dejar de apoyar esta solicitud?",
      [
        {
          text: "Volver",
          style: "cancel",
        },
        {
          text: "Sí, cancelar",
          style: "destructive",
          onPress: ejecutarCancelacion,
        },
      ]
    );
  };

  const ejecutarCancelacion = async () => {
    if (!user || procesando) {
      return;
    }

    setProcesando(true);

    try {
      const usuarioRef = doc(db, "usuarios", user.uid);

      const solicitudId = perfilUsuario.ayudaEnCurso;

      const solicitudRef = doc(db, "solicitudes", solicitudId);

      await runTransaction(db, async (transaction) => {
        const usuarioDoc = await transaction.get(usuarioRef);
        const solicitudDoc = await transaction.get(solicitudRef);

        if (!usuarioDoc.exists()) {
          throw new Error("NO_EXISTE_PERFIL");
        }

        const datosUsuario = usuarioDoc.data();

        if (datosUsuario.ayudaEnCurso !== solicitudId) {
          throw new Error("AYUDA_NO_COINCIDE");
        }

        if (solicitudDoc.exists()) {
          const datosSolicitud = solicitudDoc.data();

          // Solo el colaborador asignado puede liberar la solicitud.
          if (datosSolicitud.apoyadoPor !== user.uid) {
            throw new Error("NO_ES_TU_SOLICITUD");
          }

          transaction.update(solicitudRef, {
            estado: "Pendiente",
            apoyadoPor: deleteField(),
            apoyadoPorNombre: deleteField(),
            fechaApoyo: deleteField(),
          });
        }

        // Liberar al usuario.
        transaction.update(usuarioRef, {
          ayudaEnCurso: null,
          estadoAyuda: "Disponible",
          disponible: true,
        });
      });

      Alert.alert(
        "Apoyo cancelado",
        "La solicitud volvió a estar disponible para otros colaboradores."
      );
    } catch (error) {
      console.error("Error al cancelar apoyo:", error);

      Alert.alert(
        "No se pudo cancelar",
        "Ocurrió un problema al actualizar la solicitud. Revisa los permisos de Firestore."
      );
    } finally {
      setProcesando(false);
    }
  };

  // ==========================================
  // OBTENER ICONO SEGÚN EL TIPO DE AYUDA
  // ==========================================

  const obtenerIcono = (tipo) => {
    switch (tipo) {
      case "Médicos":
        return "medkit-outline";

      case "Primeros auxilios":
        return "medical-outline";

      case "Voluntarios":
        return "people-outline";

      case "Rescate":
        return "shield-checkmark-outline";

      case "Alimentos":
        return "restaurant-outline";

      case "Agua y suministros":
        return "water-outline";

      case "Refugio":
        return "home-outline";

      default:
        return "help-circle-outline";
    }
  };

  // ==========================================
  // OBTENER COLORES SEGÚN EL ESTADO
  // ==========================================

  const obtenerColorEstado = (estado) => {
    if (estado === "Atendida" || estado === "Resuelta") {
      return {
        fondo: "#E3F0E8",
        texto: "#2F6B4F",
      };
    }

    if (estado === "En proceso") {
      return {
        fondo: "#F6EBD2",
        texto: "#7A5A1E",
      };
    }

    return {
      fondo: "#E4ECF1",
      texto: "#2F5470",
    };
  };

  // ==========================================
  // FILTRAR SOLICITUDES
  // ==========================================

  const solicitudesFiltradas =
    filtro === "Todos"
      ? solicitudes
      : solicitudes.filter((s) => s.tipoAyuda === filtro);

  // ==========================================
  // CARGANDO TIPOGRAFÍAS
  // ==========================================

  if (!fontsLoaded) {
    return (
      <View style={styles.cargandoPantalla}>
        <ActivityIndicator size="large" color="#12343F" />
      </View>
    );
  }

  // ==========================================
  // INTERFAZ
  // ==========================================

  return (
    <>
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        {/* Imagen de bienvenida */}

        <ImageBackground
          source={{
            uri: "https://i.pinimg.com/1200x/a2/0d/6b/a20d6be9b14a1f3186c6e8a3f9ad1120.jpg",
          }}
          style={styles.background}
          imageStyle={styles.backgroundImage}
          resizeMode="cover"
        />

        {/* Estado del usuario */}

        {user && perfilUsuario && (
          <View style={styles.estadoUsuario}>
            <View style={styles.estadoUsuarioTexto}>
              <Ionicons
                name={
                  perfilUsuario.ayudaEnCurso
                    ? "time-outline"
                    : "checkmark-circle-outline"
                }
                size={22}
                color={
                  perfilUsuario.ayudaEnCurso
                    ? "#8A641E"
                    : "#2F6B4F"
                }
              />

              <View style={{ flex: 1 }}>
                <Text style={styles.estadoUsuarioTitulo}>
                  {perfilUsuario.ayudaEnCurso
                    ? "Actualmente estás ocupado"
                    : "Estás disponible para ayudar"}
                </Text>

                <Text style={styles.estadoUsuarioDescripcion}>
                  {perfilUsuario.ayudaEnCurso
                    ? "Tienes una solicitud asignada."
                    : "Puedes apoyar una solicitud de ayuda."}
                </Text>
              </View>
            </View>

            {perfilUsuario.ayudaEnCurso && (
              <TouchableOpacity
                style={styles.botonCancelarApoyo}
                onPress={cancelarAyuda}
                disabled={procesando}
                activeOpacity={0.8}
              >
                <Text style={styles.textoBotonCancelar}>
                  {procesando ? "Procesando..." : "Cancelar apoyo"}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* Encabezado de solicitudes */}

        <View style={styles.seccionSolicitudes}>
          <View style={styles.encabezadoSolicitudes}>
            <View style={styles.iconoEncabezado}>
              <Ionicons
                name="hand-left-outline"
                size={25}
                color="#FFFFFF"
              />
            </View>

            <View style={styles.encabezadoTexto}>
              <Text style={styles.tituloSolicitudes}>
                Solicitudes de ayuda
              </Text>
            </View>
          </View>

          {/* Contador y filtros */}

          {!cargando && !errorSolicitudes && (
            <>
              <View style={styles.filaContador}>
                <View style={styles.contador}>
                  <Text style={styles.textoContador}>
                    {solicitudesFiltradas.length}{" "}
                    {solicitudesFiltradas.length === 1
                      ? "solicitud registrada"
                      : "solicitudes registradas"}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[
                    styles.botonFiltro,
                    filtro !== "Todos" && styles.botonFiltroActivo,
                  ]}
                  onPress={() => setVerFiltros(!verFiltros)}
                  activeOpacity={0.8}
                >
                  <Ionicons
                    name="filter-outline"
                    size={15}
                    color={filtro !== "Todos" ? "#FFFFFF" : "#12343F"}
                  />

                  <Text
                    style={[
                      styles.textoBotonFiltro,
                      filtro !== "Todos" && { color: "#FFFFFF" },
                    ]}
                    numberOfLines={1}
                  >
                    {filtro === "Todos" ? "Filtros" : filtro}
                  </Text>

                  <Ionicons
                    name={verFiltros ? "chevron-up" : "chevron-down"}
                    size={15}
                    color={filtro !== "Todos" ? "#FFFFFF" : "#12343F"}
                  />
                </TouchableOpacity>
              </View>

              {/* Panel de filtros */}

              {verFiltros && (
                <View style={styles.panelFiltros}>
                  {TIPOS_FILTRO.map((tipo) => {
                    const activo = filtro === tipo;

                    return (
                      <TouchableOpacity
                        key={tipo}
                        style={[
                          styles.chip,
                          activo && styles.chipActivo,
                        ]}
                        onPress={() => {
                          setFiltro(tipo);
                          setVerFiltros(false);
                        }}
                        activeOpacity={0.8}
                      >
                        {tipo !== "Todos" && (
                          <Ionicons
                            name={obtenerIcono(tipo)}
                            size={14}
                            color={activo ? "#FFFFFF" : "#12343F"}
                          />
                        )}

                        <Text
                          style={[
                            styles.chipTexto,
                            activo && { color: "#FFFFFF" },
                          ]}
                        >
                          {tipo}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}
            </>
          )}

          {/* Cargando */}

          {cargando && (
            <View style={styles.estadoContenedor}>
              <ActivityIndicator size="large" color="#12343F" />

              <Text style={styles.textoEstado}>
                Cargando solicitudes...
              </Text>
            </View>
          )}

          {/* Error */}

          {!cargando && errorSolicitudes && (
            <View style={styles.estadoContenedor}>
              <Ionicons
                name="cloud-offline-outline"
                size={38}
                color="#9C3F3F"
              />

              <Text style={styles.textoError}>
                No pudimos cargar las solicitudes.
              </Text>

              <Text style={styles.textoEstado}>
                Revisa tu conexión y los permisos de lectura de Firestore
                para la colección solicitudes.
              </Text>
            </View>
          )}

          {/* Sin solicitudes */}

          {!cargando &&
            !errorSolicitudes &&
            solicitudes.length === 0 && (
              <View style={styles.estadoContenedor}>
                <Ionicons
                  name="document-text-outline"
                  size={42}
                  color="#8C979A"
                />

                <Text style={styles.textoVacio}>
                  Todavía no hay solicitudes
                </Text>

                <Text style={styles.textoEstado}>
                  Cuando alguien solicite ayuda desde Help, su solicitud
                  aparecerá aquí.
                </Text>
              </View>
            )}

          {/* Sin resultados */}

          {!cargando &&
            !errorSolicitudes &&
            solicitudes.length > 0 &&
            solicitudesFiltradas.length === 0 && (
              <View style={styles.estadoContenedor}>
                <Ionicons
                  name="search-outline"
                  size={38}
                  color="#8C979A"
                />

                <Text style={styles.textoVacio}>
                  Sin resultados
                </Text>

                <Text style={styles.textoEstado}>
                  No hay solicitudes de tipo "{filtro}".
                </Text>
              </View>
            )}

          {/* Lista de solicitudes */}

          {!cargando &&
            !errorSolicitudes &&
            solicitudesFiltradas.map((solicitud) => {
              const colorEstado = obtenerColorEstado(
                solicitud.estado
              );

              const esMiSolicitud =
                perfilUsuario?.ayudaEnCurso === solicitud.id;

              const solicitudDisponible =
                (solicitud.estado || "Pendiente") === "Pendiente" &&
                !solicitud.apoyadoPor;

              const usuarioOcupado =
                Boolean(perfilUsuario?.ayudaEnCurso);

              return (
                <View
                  key={solicitud.id}
                  style={styles.tarjetaSolicitud}
                >
                  {/* Encabezado de la tarjeta */}

                  <View style={styles.filaTarjeta}>
                    <View style={styles.iconoSolicitud}>
                      <Ionicons
                        name={obtenerIcono(solicitud.tipoAyuda)}
                        size={25}
                        color="#12343F"
                      />
                    </View>

                    <View style={styles.datosSolicitud}>
                      <Text style={styles.tipoAyuda}>
                        {solicitud.tipoAyuda || "Otro tipo de ayuda"}
                      </Text>

                      <Text style={styles.fechaSolicitud}>
                        {obtenerFecha(solicitud.fecha)}
                      </Text>
                    </View>

                    <View
                      style={[
                        styles.estadoEtiqueta,
                        { backgroundColor: colorEstado.fondo },
                      ]}
                    >
                      <Text
                        style={[
                          styles.textoEstadoEtiqueta,
                          { color: colorEstado.texto },
                        ]}
                      >
                        {solicitud.estado || "Pendiente"}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.divisorTarjeta} />

                  {/* Descripción */}

                  <Text style={styles.etiquetaDescripcion}>
                    Descripción de la necesidad
                  </Text>

                  <Text style={styles.descripcionSolicitud}>
                    {solicitud.descripcion || "Sin descripción"}
                  </Text>

                  {/* Botones de apoyo */}

                  {user && (
                    <View style={styles.contenedorAccion}>
                      {esMiSolicitud ? (
                        <View style={styles.mensajeMiApoyo}>
                          <Ionicons
                            name="checkmark-circle"
                            size={19}
                            color="#2F6B4F"
                          />

                          <Text style={styles.textoMiApoyo}>
                            Estás apoyando esta solicitud.
                          </Text>
                        </View>
                      ) : solicitudDisponible && usuarioOcupado ? (
                        <View style={styles.mensajeBloqueado}>
                          <Ionicons
                            name="lock-closed-outline"
                            size={17}
                            color="#8A641E"
                          />

                          <Text style={styles.textoBloqueado}>
                            Ya tienes otra ayuda asignada.
                          </Text>
                        </View>
                      ) : solicitudDisponible && perfilUsuario ? (
                        <TouchableOpacity
                          style={styles.botonApoyar}
                          onPress={() => abrirModalApoyo(solicitud)}
                          activeOpacity={0.85}
                        >
                          <Ionicons
                            name="hand-left-outline"
                            size={19}
                            color="#FFFFFF"
                          />

                          <Text style={styles.textoBotonApoyar}>
                            Apoyar esta causa
                          </Text>
                        </TouchableOpacity>
                      ) : solicitudDisponible && !perfilUsuario ? (
                        <Text style={styles.textoPerfilPendiente}>
                          No se encontró tu perfil de colaborador.
                        </Text>
                      ) : solicitud.apoyadoPor ? (
                        <View style={styles.mensajeBloqueado}>
                          <Ionicons
                            name="people-outline"
                            size={17}
                            color="#7A5A1E"
                          />

                          <Text style={styles.textoBloqueado}>
                            Esta solicitud ya tiene un colaborador.
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  )}
                </View>
              );
            })}

          <Text style={styles.pieSolicitudes}>
            Cada solicitud es una oportunidad para ayudar.
          </Text>
        </View>
      </ScrollView>

      {/* ======================================
          MODAL DE CONFIRMACIÓN
      ====================================== */}

      <Modal
        visible={modalApoyoVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          if (!procesando) {
            setModalApoyoVisible(false);
            setSolicitudSeleccionada(null);
          }
        }}
      >
        <View style={styles.fondoModal}>
          <View style={styles.contenidoModal}>
            <View style={styles.iconoModal}>
              <Ionicons
                name="hand-left-outline"
                size={34}
                color="#FFFFFF"
              />
            </View>

            <Text style={styles.tituloModal}>
              Confirmar apoyo
            </Text>

            <Text style={styles.descripcionModal}>
              ¿Deseas apoyar con esta causa o necesidad?
            </Text>

            {solicitudSeleccionada && (
              <View style={styles.resumenModal}>
                <Text style={styles.tipoModal}>
                  {solicitudSeleccionada.tipoAyuda ||
                    "Solicitud de ayuda"}
                </Text>

                <Text style={styles.descripcionResumenModal}>
                  {solicitudSeleccionada.descripcion ||
                    "Sin descripción"}
                </Text>
              </View>
            )}

            <Text style={styles.avisoModal}>
              Al confirmar, quedarás asignado a esta solicitud y tu
              perfil aparecerá como ocupado hasta que canceles el apoyo.
            </Text>

            <TouchableOpacity
              style={[
                styles.botonConfirmar,
                procesando && styles.botonDeshabilitado,
              ]}
              onPress={aceptarSolicitud}
              disabled={procesando}
              activeOpacity={0.85}
            >
              {procesando ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <>
                  <Ionicons
                    name="checkmark-circle-outline"
                    size={20}
                    color="#FFFFFF"
                  />

                  <Text style={styles.textoBotonConfirmar}>
                    Sí, deseo apoyar
                  </Text>
                </>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.botonCerrarModal}
              onPress={() => {
                setModalApoyoVisible(false);
                setSolicitudSeleccionada(null);
              }}
              disabled={procesando}
              activeOpacity={0.8}
            >
              <Text style={styles.textoBotonCerrar}>
                Volver
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ==========================================
// ESTILOS
// ==========================================

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F4EF",
  },

  content: {
    flexGrow: 1,
  },

  cargandoPantalla: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F4EF",
  },

  background: {
    width: "100%",
    height: 380,
  },

  backgroundImage: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },

  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.30)",
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },

  StyleTitle: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 25,
  },

  // Estado del usuario

  estadoUsuario: {
    marginHorizontal: 20,
    marginTop: 18,
    padding: 15,
    backgroundColor: "#FFFFFF",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "#E6E1D6",
  },

  estadoUsuarioTexto: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },

  estadoUsuarioTitulo: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "800",
  },

  estadoUsuarioDescripcion: {
    color: "#000000",
    fontSize: 12,
    marginTop: 4,
  },

  botonCancelarApoyo: {
    backgroundColor: "#F8E8E5",
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: "center",
    marginTop: 13,
  },

  textoBotonCancelar: {
    color: "#9C3F3F",
    fontSize: 13,
    fontWeight: "800",
  },

  // Sección de solicitudes

  seccionSolicitudes: {
    paddingHorizontal: 20,
    paddingTop: 28,
  },

  encabezadoSolicitudes: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 13,
  },

  iconoEncabezado: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: "#12343F",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  encabezadoTexto: {
    flex: 1,
  },

  tituloSolicitudes: {
    fontSize: 22,
    fontWeight: "800",
    color: "#12343F",
    letterSpacing: 0.3,
  },

  filaContador: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 15,
  },

  botonFiltro: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "#12343F",
    maxWidth: 170,
  },

  botonFiltroActivo: {
    backgroundColor: "#12343F",
  },

  textoBotonFiltro: {
    color: "#12343F",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
    flexShrink: 1,
  },

  panelFiltros: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 15,
  },

  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },

  chipActivo: {
    backgroundColor: "#12343F",
    borderColor: "#12343F",
  },

  chipTexto: {
    color: "#12343F",
    fontSize: 12,
    fontWeight: "600",
  },

  contador: {
    alignSelf: "flex-start",
    backgroundColor: "#F6EFE0",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: "#E8DCC0",
  },

  textoContador: {
    color: "#7A5A1E",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.4,
  },

  // Estados de carga y errores

  estadoContenedor: {
    backgroundColor: "#FFFFFF",
    padding: 28,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 5,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
    elevation: 2,
  },

  textoEstado: {
    color: "#000000",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
    marginTop: 10,
  },

  textoError: {
    color: "#9C3F3F",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 10,
  },

  textoVacio: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginTop: 10,
  },

  // Tarjetas

  tarjetaSolicitud: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    elevation: 3,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
  },

  filaTarjeta: {
    flexDirection: "row",
    alignItems: "center",
  },

  iconoSolicitud: {
    width: 48,
    height: 48,
    borderRadius: 15,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 11,
  },

  datosSolicitud: {
    flex: 1,
  },

  tipoAyuda: {
    color: "#000000",
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },

  fechaSolicitud: {
    color: "#000000",
    fontSize: 11,
    marginTop: 5,
    letterSpacing: 0.3,
  },

  estadoEtiqueta: {
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 6,
    marginLeft: 5,
  },

  textoEstadoEtiqueta: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },

  divisorTarjeta: {
    height: 1,
    backgroundColor: "#EEEAE0",
    marginVertical: 14,
  },

  etiquetaDescripcion: {
    color: "#000000",
    fontSize: 10,
    fontWeight: "700",
    marginBottom: 7,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },

  descripcionSolicitud: {
    color: "#000000",
    fontSize: 14,
    lineHeight: 21,
  },

  // Acciones de las solicitudes

  contenedorAccion: {
    marginTop: 15,
  },

  botonApoyar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "#12343F",
    paddingVertical: 13,
    paddingHorizontal: 15,
    borderRadius: 13,
  },

  textoBotonApoyar: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },

  mensajeMiApoyo: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#E3F0E8",
    padding: 12,
    borderRadius: 12,
  },

  textoMiApoyo: {
    color: "#2F6B4F",
    fontSize: 13,
    fontWeight: "700",
    flex: 1,
  },

  mensajeBloqueado: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "#F6EBD2",
    padding: 12,
    borderRadius: 12,
  },

  textoBloqueado: {
    color: "#7A5A1E",
    fontSize: 12,
    fontWeight: "700",
    flex: 1,
  },

  textoPerfilPendiente: {
    color: "#9C3F3F",
    fontSize: 12,
    fontWeight: "600",
  },

  pieSolicitudes: {
    color: "#000000",
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
    marginBottom: 24,
    fontStyle: "italic",
    letterSpacing: 0.3,
  },

  // Modal

  fondoModal: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
    justifyContent: "center",
    alignItems: "center",
    padding: 22,
  },

  contenidoModal: {
    width: "100%",
    maxWidth: 420,
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 23,
    alignItems: "center",
  },

  iconoModal: {
    width: 65,
    height: 65,
    borderRadius: 22,
    backgroundColor: "#12343F",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },

  tituloModal: {
    color: "#000000",
    fontSize: 21,
    fontWeight: "800",
    textAlign: "center",
  },

  descripcionModal: {
    color: "#000000",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 21,
    marginTop: 9,
  },

  resumenModal: {
    width: "100%",
    backgroundColor: "#F6F4EF",
    borderRadius: 15,
    padding: 14,
    marginTop: 17,
  },

  tipoModal: {
    color: "#12343F",
    fontSize: 15,
    fontWeight: "800",
  },

  descripcionResumenModal: {
    color: "#000000",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 6,
  },

  avisoModal: {
    color: "#000000",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    marginTop: 15,
    marginBottom: 17,
  },

  botonConfirmar: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "#12343F",
    paddingVertical: 14,
    borderRadius: 13,
  },

  botonDeshabilitado: {
    opacity: 0.6,
  },

  textoBotonConfirmar: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "800",
  },

  botonCerrarModal: {
    width: "100%",
    alignItems: "center",
    paddingVertical: 13,
    marginTop: 5,
  },

  textoBotonCerrar: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "700",
  },
});