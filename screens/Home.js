import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  ImageBackground,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";
import { useFonts } from "expo-font";

import { db } from "../firebaseConfig.js";

import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "firebase/firestore";

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
  const [cargando, setCargando] = useState(true);
  const [errorSolicitudes, setErrorSolicitudes] = useState(false);
  const [filtro, setFiltro] = useState("Todos");
  const [verFiltros, setVerFiltros] = useState(false);

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

  if (!fontsLoaded) {
    return (
      <View style={styles.cargandoPantalla}>
        <ActivityIndicator size="large" color="#12343F" />
      </View>
    );
  }

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

  const solicitudesFiltradas =
    filtro === "Todos"
      ? solicitudes
      : solicitudes.filter((s) => s.tipoAyuda === filtro);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Bienvenida */}
      <ImageBackground
        source={{
          uri: "https://i.pinimg.com/1200x/a2/0d/6b/a20d6be9b14a1f3186c6e8a3f9ad1120.jpg",
        }}
        style={styles.background}
        imageStyle={styles.backgroundImage}
        resizeMode="cover"
      >
      </ImageBackground>

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

            {verFiltros && (
              <View style={styles.panelFiltros}>
                {TIPOS_FILTRO.map((tipo) => {
                  const activo = filtro === tipo;
                  return (
                    <TouchableOpacity
                      key={tipo}
                      style={[styles.chip, activo && styles.chipActivo]}
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

        {/* Error de conexión o permisos */}
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

        {/* Sin resultados para el filtro */}
        {!cargando &&
          !errorSolicitudes &&
          solicitudes.length > 0 &&
          solicitudesFiltradas.length === 0 && (
            <View style={styles.estadoContenedor}>
              <Ionicons name="search-outline" size={38} color="#8C979A" />
              <Text style={styles.textoVacio}>Sin resultados</Text>
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

            return (
              <View
                key={solicitud.id}
                style={styles.tarjetaSolicitud}
              >
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

                <Text style={styles.etiquetaDescripcion}>
                  Descripción de la necesidad
                </Text>

                <Text style={styles.descripcionSolicitud}>
                  {solicitud.descripcion || "Sin descripción"}
                </Text>
              </View>
            );
          })}

        <Text style={styles.pieSolicitudes}>
          Cada solicitud es una oportunidad para ayudar.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F6F4EF",
  },

  content: {
    flexGrow: 25,
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

  pieSolicitudes: {
    color: "#000000",
    fontSize: 12,
    textAlign: "center",
    marginTop: 14,
    marginBottom: 24,
    fontStyle: "italic",
    letterSpacing: 0.3,
  },
});