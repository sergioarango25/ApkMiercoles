import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { WebView } from "react-native-webview";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";

// ==============================
// CACHÉ (AsyncStorage con vencimiento)
// ==============================

const HORA = 60 * 60 * 1000;

const TTL_DIRECCIONES = 24 * HORA;
const TTL_GEOCODIFICACION = 30 * 24 * HORA;
const TTL_POSICION = 7 * 24 * HORA;

const cacheGuardar = async (clave, valor) => {
  try {
    await AsyncStorage.setItem(
      `mapa:${clave}`,
      JSON.stringify({ t: Date.now(), v: valor })
    );
  } catch (e) {
    console.log("Error guardando caché:", e);
  }
};

const cacheLeer = async (clave, ttl) => {
  try {
    const crudo = await AsyncStorage.getItem(`mapa:${clave}`);

    if (!crudo) return null;

    const { t, v } = JSON.parse(crudo);

    return {
      valor: v,
      vencido: Date.now() - t > ttl,
    };
  } catch (e) {
    return null;
  }
};

// ==============================
// COORDENADAS
// ==============================

const CALI = {
  latitude: 3.4516,
  longitude: -76.532,
};

const VIEWBOX_CALI = "-76.65,3.55,-76.40,3.30";

const normalizarCoordenadas = (lat, lng) => {
  const latitude = Number(lat);
  let longitude = Number(lng);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  longitude =
    ((((longitude + 180) % 360) + 360) % 360) - 180;

  if (latitude < -90 || latitude > 90) return null;

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
  };
};

const claveCoordenadas = (lat, lng) =>
  `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;

// ==============================
// CONSULTA DE SERVICIOS
// (Overpass con respaldo en Nominatim)
// ==============================

const SERVIDORES_OVERPASS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

const fetchConTiempo = async (url, opciones, ms) => {
  const controlador = new AbortController();
  const temporizador = setTimeout(() => controlador.abort(), ms);

  try {
    return await fetch(url, {
      ...opciones,
      signal: controlador.signal,
    });
  } finally {
    clearTimeout(temporizador);
  }
};

const buscarEnOverpass = async (tipo, lat, lng) => {
  const filtro =
    tipo === "policia"
      ? '["amenity"="police"]'
      : '["amenity"="fire_station"]';

  const consulta =
    `[out:json][timeout:20];` +
    `nwr${filtro}(around:5000,${lat},${lng});` +
    `out center tags 30;`;

  let ultimoError = null;

  for (const servidor of SERVIDORES_OVERPASS) {
    try {
      const respuesta = await fetchConTiempo(
        servidor,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
            "User-Agent": "Domingo-App",
          },
          body: "data=" + encodeURIComponent(consulta),
        },
        25000
      );

      if (!respuesta.ok) {
        throw new Error("HTTP " + respuesta.status);
      }

      const datos = await respuesta.json();

      return (datos.elements || [])
        .map((e) => {
          const latitud = e.lat ?? e.center?.lat;
          const longitud = e.lon ?? e.center?.lon;

          if (
            typeof latitud !== "number" ||
            typeof longitud !== "number"
          ) {
            return null;
          }

          return {
            latitude: latitud,
            longitude: longitud,
            nombre:
              e.tags?.name ||
              (tipo === "policia"
                ? "Estación de Policía"
                : "Estación de Bomberos"),
          };
        })
        .filter(Boolean);
    } catch (error) {
      console.log("Overpass falló en", servidor, "->", error?.message);
      ultimoError = error;
    }
  }

  throw ultimoError || new Error("Overpass no disponible");
};

const buscarEnNominatim = async (tipo, lat, lng) => {
  const d = 0.05; // aprox. 5 km

  const viewbox = `${lng - d},${lat + d},${lng + d},${lat - d}`;

  const texto =
    tipo === "policia"
      ? "estación de policía"
      : "estación de bomberos";

  const respuesta = await fetchConTiempo(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
      texto
    )}&viewbox=${viewbox}&bounded=1&limit=20&accept-language=es`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "Domingo-App",
      },
    },
    15000
  );

  if (!respuesta.ok) {
    throw new Error("Nominatim HTTP " + respuesta.status);
  }

  const datos = await respuesta.json();

  return datos
    .map((i) => ({
      latitude: Number(i.lat),
      longitude: Number(i.lon),
      nombre: String(i.display_name || texto).split(",")[0],
    }))
    .filter(
      (i) =>
        Number.isFinite(i.latitude) &&
        Number.isFinite(i.longitude)
    );
};

const consultarServicios = async (tipo, lat, lng) => {
  try {
    return await buscarEnOverpass(tipo, lat, lng);
  } catch (error) {
    console.log("Usando respaldo Nominatim:", error?.message);
    return await buscarEnNominatim(tipo, lat, lng);
  }
};

// ============================================================
// COMPONENTE PRINCIPAL
// ============================================================

export default function Map() {
  const webViewRef = useRef(null);
  const posicionInicial = useRef(null);
  const scrollRef = useRef(null);

  // Indica de dónde salió el punto usado para buscar servicios:
  // "gps" | "ultima" | "punto" | "centro"
  const origenBusqueda = useRef("gps");

  const [tecladoVisible, setTecladoVisible] = useState(false);
  const [alturaTeclado, setAlturaTeclado] = useState(0);

  // ==============================
  // ESTADOS
  // ==============================

  const [modo, setModo] = useState("mapa");

  const [nombre, setNombre] = useState("");
  const [direccion, setDireccion] = useState("");

  const [latitudSeleccionada, setLatitudSeleccionada] =
    useState(CALI.latitude);

  const [longitudSeleccionada, setLongitudSeleccionada] =
    useState(CALI.longitude);

  const [direcciones, setDirecciones] = useState([]);

  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [buscando, setBuscando] = useState(false);
  const [ubicando, setUbicando] = useState(false);
  const [precision, setPrecision] = useState(null);

  // Estados para Policía y Bomberos

  const [buscandoServicios, setBuscandoServicios] = useState(false);
  const [servicioActivo, setServicioActivo] = useState(null);
  const [mapaListo, setMapaListo] = useState(false);
  const [puntoManualSeleccionado, setPuntoManualSeleccionado] =
    useState(false);

  // ==============================
  // INICIAR MAPA
  // ==============================

  useEffect(() => {
    const iniciarMapa = async () => {
      await restaurarUltimaPosicion();

      const usuario = auth.currentUser;

      if (usuario) {
        try {
          await AsyncStorage.removeItem(
            `mapa:direcciones:${usuario.uid}`
          );
        } catch (error) {
          console.log("Error limpiando caché anterior:", error);
        }
      }

      cargarDirecciones();

      try {
        await Location.requestForegroundPermissionsAsync();
      } catch (error) {
        console.log("Error solicitando permiso:", error);
      }
    };

    iniciarMapa();
  }, []);

  // ==============================
  // DETECTAR TECLADO
  // ==============================

  useEffect(() => {
    const mostrar = Keyboard.addListener(
      Platform.OS === "ios"
        ? "keyboardWillShow"
        : "keyboardDidShow",
      (e) => {
        setTecladoVisible(true);
        setAlturaTeclado(e.endCoordinates?.height || 0);
      }
    );

    const ocultar = Keyboard.addListener(
      Platform.OS === "ios"
        ? "keyboardWillHide"
        : "keyboardDidHide",
      () => {
        setTecladoVisible(false);
        setAlturaTeclado(0);
      }
    );

    return () => {
      mostrar.remove();
      ocultar.remove();
    };
  }, []);

  // ==============================
  // LIMPIAR ÚLTIMA POSICIÓN
  // ==============================

  const restaurarUltimaPosicion = async () => {
    try {
      await AsyncStorage.removeItem("mapa:ultimaPosicion");

      posicionInicial.current = null;
    } catch (error) {
      console.log("Error limpiando última posición:", error);
    }
  };

  // ==============================
  // MOVER MAPA
  // ==============================

  const moverMapa = (lat, lng, zoom = 15) => {
    webViewRef.current?.injectJavaScript(`
      if (typeof irA === "function") {
        irA(${lat}, ${lng}, ${zoom});
      }
      true;
    `);
  };

  // ==============================
  // CARGAR DIRECCIONES DE FIREBASE
  // ==============================

  const cargarDirecciones = async (forzar = false) => {
    try {
      const usuario = auth.currentUser;

      if (!usuario) {
        setDirecciones([]);
        setCargando(false);
        return;
      }

      const consulta = query(
        collection(db, "direcciones"),
        where("userId", "==", usuario.uid)
      );

      const resultado = await getDocs(consulta);

      const lista = resultado.docs
        .map((documento) => ({
          id: documento.id,
          ...documento.data(),
        }))
        .filter((item) => item.versionMapa === "actual");

      setDirecciones(lista);
    } catch (error) {
      console.log("Error cargando direcciones:", error);

      if (direcciones.length === 0) {
        Alert.alert(
          "Error",
          "No fue posible cargar tus direcciones."
        );
      }
    } finally {
      setCargando(false);
    }
  };

  // ==============================
  // HTML DEL MAPA
  // ==============================

  const mapaHTML = useMemo(
    () => `
    <!DOCTYPE html>

    <html>

    <head>

      <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
      />

      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
      />

      <script
        src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js">
      </script>

      <style>

        html,
        body {
          margin: 0;
          padding: 0;
          width: 100%;
          height: 100%;
        }

        #map {
          width: 100%;
          height: 100%;
        }

        .leaflet-popup-content-wrapper {
          border-radius: 12px;
        }

        .leaflet-popup-content {
          color: #000000;
          font-family: Arial, sans-serif;
          font-size: 13px;
        }

        .marcador-servicio {
          width: 32px;
          height: 32px;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #FFFFFF;
          font-size: 13px;
          font-weight: bold;
          border: 2px solid #FFFFFF;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
        }

        .marcador-policia {
          background: #245B8F;
        }

        .marcador-bomberos {
          background: #C43B32;
        }

      </style>

    </head>

    <body>

      <div id="map"></div>

      <script>

        const map = L.map("map", {
          worldCopyJump: true,
          maxBounds: [[-85, -180], [85, 180]],
          maxBoundsViscosity: 1.0
        }).setView(
          [${CALI.latitude}, ${CALI.longitude}],
          13
        );

        // ==========================================
        // CACHÉ DE TESELAS (IndexedDB)
        // ==========================================

        const TILE_TTL = 14 * 24 * 60 * 60 * 1000;
        const TILE_MAX = 1500;

        let tileDB = null;

        const abrirTileDB = () => new Promise((resolve) => {
          try {
            const req = indexedDB.open("tiles-mapa", 1);

            req.onupgradeneeded = () => {
              req.result.createObjectStore("tiles");
            };

            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);

          } catch (e) {
            resolve(null);
          }
        });

        const tileGet = (key) => new Promise((resolve) => {
          if (!tileDB) return resolve(null);

          try {
            const r = tileDB
              .transaction("tiles")
              .objectStore("tiles")
              .get(key);

            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => resolve(null);

          } catch (e) {
            resolve(null);
          }
        });

        const tilePut = (key, blob) => {
          if (!tileDB) return;

          try {
            const store = tileDB
              .transaction("tiles", "readwrite")
              .objectStore("tiles");

            store.put({
              blob: blob,
              t: Date.now()
            }, key);

            const c = store.count();

            c.onsuccess = () => {
              if (c.result > TILE_MAX) {
                const k = store.openCursor();

                let borrar = c.result - TILE_MAX;

                k.onsuccess = () => {
                  const cur = k.result;

                  if (cur && borrar-- > 0) {
                    cur.delete();
                    cur.continue();
                  }
                };
              }
            };

          } catch (e) {}
        };

        const CapaCache = L.TileLayer.extend({

          createTile: function(coords, done) {

            const img = document.createElement("img");

            img.alt = "";
            img.setAttribute("role", "presentation");

            const url = this.getTileUrl(coords);

            const key =
              coords.z + "/" + coords.x + "/" + coords.y;

            const desdeRed = () => {

              fetch(url)
                .then((r) => {
                  if (!r.ok) throw new Error("tile");
                  return r.blob();
                })
                .then((blob) => {
                  tilePut(key, blob);
                  img.src = URL.createObjectURL(blob);
                })
                .catch(() => {
                  img.src = url;
                });

            };

            img.onload = () => done(null, img);
            img.onerror = () => done(null, img);

            tileGet(key).then((item) => {

              if (item && item.blob) {

                img.src = URL.createObjectURL(item.blob);

                if (
                  Date.now() - item.t > TILE_TTL &&
                  navigator.onLine
                ) {

                  fetch(url)
                    .then((r) => r.ok ? r.blob() : null)
                    .then((b) => b && tilePut(key, b))
                    .catch(() => {});

                }

              } else {

                desdeRed();

              }

            });

            return img;
          }

        });

        abrirTileDB().then((db) => {

          tileDB = db;

          new CapaCache(
            "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
            {
              maxZoom: 19,
              attribution: "&copy; OpenStreetMap contributors"
            }
          ).addTo(map);

        });

        let marcadorSeleccionado = null;

        // ==========================================
        // MAPA LIMPIO AL INICIAR
        // ==========================================

        // No se cargan marcadores ficticios ni ubicaciones
        // de ejemplo al iniciar el mapa.

        // ==========================================
        // TOCAR MAPA
        // ==========================================

        map.on("click", function(evento) {

          const lat = evento.latlng.lat;
          const lng = evento.latlng.lng;

          if (marcadorSeleccionado) {
            map.removeLayer(marcadorSeleccionado);
          }

          marcadorSeleccionado = L.marker([
            lat,
            lng
          ]).addTo(map);

          marcadorSeleccionado.bindPopup(
            "<b>Ubicación seleccionada</b>"
          ).openPopup();

          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              tipo: "ubicacion",
              latitude: lat,
              longitude: lng
            })
          );

        });

        // ==========================================
        // FUNCIONES PARA MOSTRAR MARCADOR
        // ==========================================

        function irA(lat, lng, zoom) {
          map.setView([lat, lng], zoom || 15);
        }

        function mostrarMarcador(lat, lng, nombre) {

          if (marcadorSeleccionado) {
            map.removeLayer(marcadorSeleccionado);
          }

          marcadorSeleccionado = L.marker([
            lat,
            lng
          ]).addTo(map);

          const titulo = document.createElement("b");

          titulo.textContent = nombre;

          marcadorSeleccionado
            .bindPopup(titulo)
            .openPopup();

          map.setView([lat, lng], 17);
        }

        // ==========================================
        // MARCADORES DE POLICÍA Y BOMBEROS
        // ==========================================

        let marcadoresServicios = [];

        function limpiarMarcadoresServicios() {

          marcadoresServicios.forEach((marcador) => {
            map.removeLayer(marcador);
          });

          marcadoresServicios = [];

        }

        // ==========================================
        // DISTANCIA ENTRE COORDENADAS
        // ==========================================

        function calcularDistancia(lat1, lon1, lat2, lon2) {

          const R = 6371000;

          const rad = (valor) => valor * Math.PI / 180;

          const dLat = rad(lat2 - lat1);
          const dLon = rad(lon2 - lon1);

          const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(rad(lat1)) *
            Math.cos(rad(lat2)) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);

          const c =
            2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

          return R * c;

        }

        // ==========================================
        // MOSTRAR SERVICIOS (los datos llegan desde React Native)
        // ==========================================

        // IMPORTANTE: dentro de mapaHTML no se usan plantillas
        // de texto anidadas (ni comillas invertidas); se usa
        // concatenación.

        function mostrarServicios(tipo, lugares, lat, lng) {

          limpiarMarcadoresServicios();

          const esPolicia = tipo === "policia";

          lugares.forEach(function(lugar) {
            lugar.distancia = calcularDistancia(
              lat,
              lng,
              lugar.latitude,
              lugar.longitude
            );
          });

          lugares.sort(function(a, b) {
            return a.distancia - b.distancia;
          });

          lugares = lugares.slice(0, 12);

          lugares.forEach(function(lugar) {

            const contenidoIcono =
              '<div class="marcador-servicio ' +
              (esPolicia
                ? "marcador-policia"
                : "marcador-bomberos") +
              '">' +
              (esPolicia ? "P" : "B") +
              "</div>";

            const icono = L.divIcon({
              className: "",
              html: contenidoIcono,
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            });

            const marcador = L.marker(
              [lugar.latitude, lugar.longitude],
              { icon: icono }
            ).addTo(map);

            const contenido = document.createElement("div");
            const titulo = document.createElement("strong");
            const distancia = document.createElement("p");

            titulo.textContent = lugar.nombre;

            distancia.textContent =
              lugar.distancia >= 1000
                ? (lugar.distancia / 1000).toFixed(2) + " km aproximadamente"
                : Math.round(lugar.distancia) + " metros aproximadamente";

            contenido.appendChild(titulo);
            contenido.appendChild(distancia);

            marcador.bindPopup(contenido);

            marcadoresServicios.push(marcador);

          });

          if (lugares.length > 0) {

            const limites = lugares.map(function(lugar) {
              return [lugar.latitude, lugar.longitude];
            });

            limites.push([lat, lng]);

            map.fitBounds(limites, {
              padding: [35, 35],
              maxZoom: 15
            });

          } else {

            map.setView([lat, lng], 14);

          }

          window.ReactNativeWebView.postMessage(
            JSON.stringify({
              tipo: "resultadoServicios",
              categoria: tipo,
              cantidad: lugares.length
            })
          );

        }

      </script>

    </body>

    </html>
  `,
    []
  );

  // ==============================
  // RECIBIR INFORMACIÓN DEL MAPA
  // ==============================

  const seleccionarUbicacion = async (event) => {
    try {
      const datos = JSON.parse(event.nativeEvent.data);

      // Resultados de Policía o Bomberos.

      if (datos.tipo === "resultadoServicios") {
        setBuscandoServicios(false);

        const categoria =
          datos.categoria === "policia"
            ? "Policía"
            : "Bomberos";

        let nota = "";

        if (origenBusqueda.current === "ultima") {
          nota =
            "\n\nNota: no pudimos obtener tu GPS actual, así que usamos tu última ubicación conocida.";
        } else if (origenBusqueda.current === "punto") {
          nota =
            "\n\nNota: no pudimos obtener tu GPS, así que buscamos cerca del punto que seleccionaste en el mapa.";
        } else if (origenBusqueda.current === "centro") {
          nota =
            "\n\nNota: no pudimos obtener tu ubicación, así que buscamos cerca del centro de Cali. Activa el GPS o toca un punto en el mapa para buscar en otra zona.";
        }

        if (datos.cantidad === 0) {
          Alert.alert(
            "Sin resultados",
            `No encontramos establecimientos registrados de ${categoria} en un radio de 5 kilómetros.${nota}`
          );
        } else {
          Alert.alert(
            "Búsqueda completada",
            `Encontramos ${datos.cantidad} establecimientos registrados de ${categoria}. Los más cercanos aparecen en el mapa.${nota}`
          );
        }

        return;
      }

      // Error mostrando establecimientos.

      if (datos.tipo === "errorServicios") {
        setBuscandoServicios(false);

        console.log("Detalle error servicios:", datos.detalle);

        Alert.alert(
          "Error de búsqueda",
          "No fue posible mostrar los establecimientos cercanos. Intenta nuevamente."
        );

        return;
      }

      if (datos.tipo !== "ubicacion") return;

      const c = normalizarCoordenadas(
        datos.latitude,
        datos.longitude
      );

      if (!c) return;

      setLatitudSeleccionada(c.latitude);
      setLongitudSeleccionada(c.longitude);
      setPrecision(null);
      setPuntoManualSeleccionado(true);

      const textoCoordenadas =
        `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`;

      setDireccion(textoCoordenadas);

      const nombreLugar = await geocodificacionInversa(
        c.latitude,
        c.longitude
      );

      if (nombreLugar) {
        setDireccion(nombreLugar);
      }

    } catch (error) {
      console.log("Error leyendo ubicación:", error);
    }
  };

  // ==============================
  // GEOCODIFICACIÓN INVERSA
  // coordenadas -> dirección legible
  // ==============================

  const geocodificacionInversa = async (lat, lng) => {
    const clave =
      `inversa:${claveCoordenadas(lat, lng)}`;

    const enCache = await cacheLeer(
      clave,
      TTL_GEOCODIFICACION
    );

    if (enCache && !enCache.vencido) {
      return enCache.valor;
    }

    try {
      const respuesta = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&accept-language=es`,
        {
          headers: {
            Accept: "application/json",
            "User-Agent": "Domingo-App",
          },
        }
      );

      const datos = await respuesta.json();

      if (datos && datos.display_name) {
        await cacheGuardar(
          clave,
          datos.display_name
        );

        return datos.display_name;
      }

    } catch (error) {
      console.log(
        "Error en geocodificación inversa:",
        error
      );
    }

    return enCache ? enCache.valor : null;
  };

  // ==============================
  // USAR MI UBICACIÓN (GPS)
  // ==============================

  const usarMiUbicacion = async () => {
    try {
      setUbicando(true);

      const permiso =
        await Location.requestForegroundPermissionsAsync();

      if (permiso.status !== "granted") {
        Alert.alert(
          "Permiso denegado",
          "Activa el permiso de ubicación para usar tu posición actual."
        );

        return;
      }

      const rapida =
        await Location.getLastKnownPositionAsync();

      if (rapida) {
        moverMapa(
          rapida.coords.latitude,
          rapida.coords.longitude,
          15
        );
      }

      const posicion =
        await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.High,
        });

      const c = normalizarCoordenadas(
        posicion.coords.latitude,
        posicion.coords.longitude
      );

      if (!c) {
        throw new Error("Coordenadas inválidas");
      }

      setLatitudSeleccionada(c.latitude);
      setLongitudSeleccionada(c.longitude);

      setPrecision(
        posicion.coords.accuracy
          ? Math.round(posicion.coords.accuracy)
          : null
      );

      setPuntoManualSeleccionado(false);

      posicionInicial.current = c;

      webViewRef.current?.injectJavaScript(`
        mostrarMarcador(
          ${c.latitude},
          ${c.longitude},
          "Tu ubicación"
        );
        true;
      `);

      const nombreLugar = await geocodificacionInversa(
        c.latitude,
        c.longitude
      );

      setDireccion(
        nombreLugar ||
        `${c.latitude.toFixed(6)}, ${c.longitude.toFixed(6)}`
      );

    } catch (error) {
      console.log(
        "Error obteniendo ubicación:",
        error
      );

      Alert.alert(
        "Error",
        "No fue posible obtener tu ubicación. Revisa que el GPS esté activo."
      );

    } finally {
      setUbicando(false);
    }
  };

  // ==============================
  // OBTENER PUNTO PARA BUSCAR SERVICIOS
  // (con varios respaldos para que no falle)
  // ==============================

  const obtenerPuntoParaServicios = async () => {
    let permiso = null;

    try {
      permiso = await Location.requestForegroundPermissionsAsync();
    } catch (error) {
      console.log("Error pidiendo permiso:", error);
    }

    if (permiso && permiso.status === "granted") {
      // 1) GPS actual con precisión media y límite de tiempo.

      try {
        const posicion = await Promise.race([
          Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          }),
          new Promise((_, rechazar) =>
            setTimeout(
              () => rechazar(new Error("Tiempo agotado")),
              10000
            )
          ),
        ]);

        const c = normalizarCoordenadas(
          posicion.coords.latitude,
          posicion.coords.longitude
        );

        if (c) {
          return {
            c,
            origen: "gps",
            precision: posicion.coords.accuracy
              ? Math.round(posicion.coords.accuracy)
              : null,
          };
        }
      } catch (error) {
        console.log("GPS actual no disponible:", error);
      }

      // 2) Última posición conocida.

      try {
        const ultima = await Location.getLastKnownPositionAsync();

        if (ultima) {
          const c = normalizarCoordenadas(
            ultima.coords.latitude,
            ultima.coords.longitude
          );

          if (c) {
            return { c, origen: "ultima", precision: null };
          }
        }
      } catch (error) {
        console.log("Última posición no disponible:", error);
      }
    }

    // 3) Punto que el usuario tocó en el mapa o buscó.

    if (puntoManualSeleccionado) {
      const c = normalizarCoordenadas(
        latitudSeleccionada,
        longitudSeleccionada
      );

      if (c) {
        return { c, origen: "punto", precision: null };
      }
    }

    // 4) Centro de Cali como último recurso.

    return {
      c: { latitude: CALI.latitude, longitude: CALI.longitude },
      origen: "centro",
      precision: null,
    };
  };

  // ==============================
  // BUSCAR POLICÍA Y BOMBEROS
  // ==============================

  const buscarServiciosEnMapa = async (tipo) => {
    if (buscandoServicios) return;

    try {
      setBuscandoServicios(true);
      setServicioActivo(tipo);

      const { c, origen, precision: prec } =
        await obtenerPuntoParaServicios();

      origenBusqueda.current = origen;

      const lat = c.latitude;
      const lng = c.longitude;

      if (origen === "gps" || origen === "ultima") {
        setLatitudSeleccionada(lat);
        setLongitudSeleccionada(lng);
        setPrecision(prec);
        setPuntoManualSeleccionado(false);

        posicionInicial.current = c;

        webViewRef.current?.injectJavaScript(`
          mostrarMarcador(
            ${lat},
            ${lng},
            "Tu ubicación"
          );
          true;
        `);
      }

      // Consultar desde React Native y dibujar en el mapa.

      const lugares = await consultarServicios(tipo, lat, lng);

      webViewRef.current?.injectJavaScript(`
        mostrarServicios(
          ${JSON.stringify(tipo)},
          ${JSON.stringify(lugares)},
          ${lat},
          ${lng}
        );
        true;
      `);

    } catch (error) {
      console.log(
        "Error buscando establecimientos:",
        error
      );

      setBuscandoServicios(false);
      setServicioActivo(null);

      Alert.alert(
        "Error de búsqueda",
        "No fue posible consultar los establecimientos cercanos. Revisa tu conexión a internet e inténtalo nuevamente."
      );
    }
  };

  // ==============================
  // BUSCAR DIRECCIÓN MANUAL
  // ==============================

  const buscarDireccion = async () => {
    if (!direccion.trim()) {
      Alert.alert(
        "Dirección vacía",
        "Escribe una dirección para buscar."
      );

      return;
    }

    try {
      setBuscando(true);

      const consultaTexto = direccion.trim();

      const claveBusqueda =
        `busqueda:${consultaTexto.toLowerCase()}`;

      let resultados;

      const enCache = await cacheLeer(
        claveBusqueda,
        TTL_GEOCODIFICACION
      );

      if (enCache && !enCache.vencido) {
        resultados = enCache.valor;

      } else {
        const direccionCodificada =
          encodeURIComponent(consultaTexto);

        const respuesta = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${direccionCodificada}&limit=1&countrycodes=co&addressdetails=0&accept-language=es&viewbox=${VIEWBOX_CALI}&bounded=0`,
          {
            headers: {
              Accept: "application/json",
              "User-Agent": "Domingo-App",
            },
          }
        );

        resultados = await respuesta.json();

        if (resultados && resultados.length > 0) {
          await cacheGuardar(
            claveBusqueda,
            resultados
          );
        }
      }

      if (!resultados || resultados.length === 0) {
        Alert.alert(
          "No encontrada",
          "No encontramos esa dirección. Intenta escribirla de otra manera."
        );

        return;
      }

      const resultado = resultados[0];

      const c = normalizarCoordenadas(
        resultado.lat,
        resultado.lon
      );

      if (!c) {
        Alert.alert(
          "Error",
          "La búsqueda devolvió coordenadas inválidas."
        );

        return;
      }

      const lat = c.latitude;
      const lon = c.longitude;

      setLatitudSeleccionada(lat);
      setLongitudSeleccionada(lon);
      setPrecision(null);
      setPuntoManualSeleccionado(true);

      setDireccion(resultado.display_name);

      webViewRef.current?.injectJavaScript(`
        mostrarMarcador(
          ${lat},
          ${lon},
          "Ubicación encontrada"
        );
        true;
      `);

    } catch (error) {
      console.log(
        "Error buscando dirección:",
        error
      );

      Alert.alert(
        "Error",
        "No fue posible buscar la dirección."
      );

    } finally {
      setBuscando(false);
    }
  };

  // ==============================
  // MOSTRAR UBICACIÓN SELECCIONADA
  // ==============================

  const mostrarUbicacion = () => {
    webViewRef.current?.injectJavaScript(`
      mostrarMarcador(
        ${latitudSeleccionada},
        ${longitudSeleccionada},
        "Ubicación seleccionada"
      );
      true;
    `);
  };

  // ==============================
  // GUARDAR EN FIREBASE
  // ==============================

  const guardarDireccion = async () => {
    if (!nombre.trim()) {
      Alert.alert(
        "Falta información",
        "Escribe un nombre para el lugar."
      );

      return;
    }

    if (!direccion.trim()) {
      Alert.alert(
        "Falta información",
        "Selecciona o busca una dirección."
      );

      return;
    }

    try {
      const usuario = auth.currentUser;

      if (!usuario) {
        Alert.alert(
          "Sesión no encontrada",
          "Debes iniciar sesión para guardar una dirección."
        );

        return;
      }

      setGuardando(true);

      const coordenadas = normalizarCoordenadas(
        latitudSeleccionada,
        longitudSeleccionada
      );

      if (!coordenadas) {
        Alert.alert(
          "Ubicación inválida",
          "Selecciona nuevamente una ubicación válida."
        );

        return;
      }

      await addDoc(
        collection(db, "direcciones"),
        {
          userId: usuario.uid,
          nombre: nombre.trim(),
          direccion: direccion.trim(),
          latitude: coordenadas.latitude,
          longitude: coordenadas.longitude,
          createdAt: serverTimestamp(),
          versionMapa: "actual",
        }
      );

      Alert.alert(
        "Lugar guardado",
        "La dirección se guardó correctamente."
      );

      setNombre("");
      setDireccion("");

      await cargarDirecciones(true);

    } catch (error) {
      console.log(
        "Error guardando dirección:",
        error
      );

      Alert.alert(
        "Error",
        "No fue posible guardar la dirección."
      );

    } finally {
      setGuardando(false);
    }
  };

  // ==============================
  // ELIMINAR DIRECCIÓN
  // ==============================

  const eliminarDireccion = (id) => {
    Alert.alert(
      "Eliminar lugar",
      "¿Quieres eliminar esta dirección?",
      [
        {
          text: "Cancelar",
          style: "cancel",
        },
        {
          text: "Eliminar",
          style: "destructive",

          onPress: async () => {
            try {
              await deleteDoc(
                doc(
                  db,
                  "direcciones",
                  id
                )
              );

              await cargarDirecciones(true);

              Alert.alert(
                "Eliminado",
                "La dirección fue eliminada."
              );

            } catch (error) {
              console.log(
                "Error eliminando:",
                error
              );

              Alert.alert(
                "Error",
                "No fue posible eliminar la dirección."
              );
            }
          },
        },
      ]
    );
  };

  // ==============================
  // MOSTRAR DIRECCIÓN GUARDADA
  // ==============================

  const mostrarDireccionGuardada = (item) => {
    setLatitudSeleccionada(item.latitude);
    setLongitudSeleccionada(item.longitude);

    setDireccion(item.direccion);

    setPuntoManualSeleccionado(true);

    webViewRef.current?.injectJavaScript(`
      mostrarMarcador(
        ${item.latitude},
        ${item.longitude},
        ${JSON.stringify(String(item.nombre || ""))}
      );
      true;
    `);
  };

  // ==============================
  // CAMBIAR MODO
  // ==============================

  const cambiarModo = (nuevoModo) => {
    setModo(nuevoModo);

    if (nuevoModo === "mapa") {
      setDireccion("");
    }
  };

  // ==============================
  // INTERFAZ
  // ==============================

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >

      {/* ENCABEZADO */}

      <View style={styles.encabezado}>
        <Text style={styles.titulo}>
          Mapa de emergencia
        </Text>

        <Text style={styles.subtitulo}>
          Encuentra ubicaciones y servicios cercanos
        </Text>
      </View>

      {/* MAPA */}

      <View
        style={[
          styles.mapaContainer,
          tecladoVisible && styles.mapaOculto,
        ]}
      >

        <WebView
          ref={webViewRef}
          originWhitelist={["*"]}
          source={{
            html: mapaHTML,
            baseUrl: "https://app.local/",
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          cacheEnabled={true}
          cacheMode="LOAD_CACHE_ELSE_NETWORK"
          onLoadEnd={() => {
            setMapaListo(true);

            const p = posicionInicial.current;

            if (p) {
              moverMapa(p.latitude, p.longitude);
            }
          }}
          onMessage={seleccionarUbicacion}
          style={styles.mapa}
        />

        {/* BOTONES DE SERVICIOS (a la derecha) */}

        <View style={styles.botonesServicios}>

          {buscandoServicios && (
            <ActivityIndicator
              size="small"
              color="#245B45"
            />
          )}

          <TouchableOpacity
            style={[
              styles.botonServicio,
              servicioActivo === "policia" &&
                styles.botonServicioActivo,
            ]}
            onPress={() => buscarServiciosEnMapa("policia")}
            disabled={!mapaListo || buscandoServicios}
            activeOpacity={0.8}
          >
            <Ionicons
              name="shield-checkmark-outline"
              size={17}
              color="#000000"
            />

            <Text style={styles.textoServicio}>
              Policía
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.botonServicio,
              servicioActivo === "bomberos" &&
                styles.botonServicioActivo,
            ]}
            onPress={() => buscarServiciosEnMapa("bomberos")}
            disabled={!mapaListo || buscandoServicios}
            activeOpacity={0.8}
          >
            <Ionicons
              name="flame-outline"
              size={17}
              color="#000000"
            />

            <Text style={styles.textoServicio}>
              Bomberos
            </Text>
          </TouchableOpacity>

        </View>

        {/* BOTÓN MI UBICACIÓN */}

        <TouchableOpacity
          style={[
            styles.botonCentrar,
            { bottom: 64 },
          ]}
          onPress={usarMiUbicacion}
          disabled={ubicando}
        >
          {ubicando ? (
            <ActivityIndicator size="small" />
          ) : (
            <View style={styles.botonMapaFila}>
              <Ionicons
                name="locate-outline"
                size={18}
                color="#12343F"
              />

              <Text style={styles.botonCentrarTexto}>
                Mi ubicación
              </Text>
            </View>
          )}
        </TouchableOpacity>

        {/* BOTÓN CENTRAR */}

        <TouchableOpacity
          style={styles.botonCentrar}
          onPress={mostrarUbicacion}
        >
          <View style={styles.botonMapaFila}>
            <Ionicons
              name="navigate-outline"
              size={18}
              color="#12343F"
            />

            <Text style={styles.botonCentrarTexto}>
              Centrar
            </Text>
          </View>
        </TouchableOpacity>

      </View>

      <Text style={styles.notaMapa}>
        Policía y Bomberos muestran establecimientos públicos registrados.
        No representan unidades de emergencia en tiempo real.
      </Text>

      <ScrollView
        ref={scrollRef}
        style={styles.contenido}
        contentContainerStyle={{
          paddingBottom:
            40 +
            (Platform.OS === "android" ? alturaTeclado : 0),
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets={true}
        showsVerticalScrollIndicator={false}
      >

        {/* TÍTULO DE SELECCIÓN */}

        <Text style={styles.tituloSeccion}>
          ¿Cómo quieres agregar el lugar?
        </Text>

        {/* OPCIONES */}

        <View style={styles.opciones}>

          <TouchableOpacity
            style={[
              styles.opcion,
              modo === "mapa" &&
                styles.opcionSeleccionada,
            ]}
            onPress={() => cambiarModo("mapa")}
          >
            <Ionicons
              name="location-outline"
              size={26}
              color={modo === "mapa" ? "#12343F" : "#8C979A"}
              style={styles.opcionIcono}
            />

            <Text
              style={[
                styles.opcionTitulo,
                modo === "mapa" &&
                  styles.opcionTituloSeleccionado,
              ]}
            >
              Desde el mapa
            </Text>

            <Text style={styles.opcionTexto}>
              Toca un punto
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.opcion,
              modo === "direccion" &&
                styles.opcionSeleccionada,
            ]}
            onPress={() => cambiarModo("direccion")}
          >
            <Ionicons
              name="search-outline"
              size={26}
              color={modo === "direccion" ? "#12343F" : "#8C979A"}
              style={styles.opcionIcono}
            />

            <Text
              style={[
                styles.opcionTitulo,
                modo === "direccion" &&
                  styles.opcionTituloSeleccionado,
              ]}
            >
              Escribir dirección
            </Text>

            <Text style={styles.opcionTexto}>
              Busca una dirección
            </Text>
          </TouchableOpacity>

        </View>

        {/* MODO MAPA */}

        {modo === "mapa" && (
          <View style={styles.panel}>

            <Text style={styles.panelTitulo}>
              Selecciona una ubicación
            </Text>

            <Text style={styles.panelTexto}>
              Toca directamente sobre el mapa para elegir el lugar.
            </Text>

            {direccion !== "" && (
              <View style={styles.ubicacionSeleccionada}>

                <View style={styles.botonMapaFila}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color="#2F6B4F"
                  />

                  <Text style={styles.ubicacionTitulo}>
                    Ubicación seleccionada
                  </Text>
                </View>

                <Text style={styles.ubicacionTexto}>
                  {direccion}
                </Text>

              </View>
            )}

          </View>
        )}

        {/* MODO DIRECCIÓN */}

        {modo === "direccion" && (
          <View style={styles.panel}>

            <Text style={styles.panelTitulo}>
              Escribe la dirección
            </Text>

            <Text style={styles.panelTexto}>
              Escribe una dirección y la ubicaremos automáticamente en el mapa.
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Ej: Calle 5 # 10-20, Cali"
              placeholderTextColor="#777777"
              value={direccion}
              onChangeText={setDireccion}
              returnKeyType="search"
              onSubmitEditing={buscarDireccion}
              autoCorrect={false}
            />

            <TouchableOpacity
              style={[
                styles.botonBuscar,
                buscando && styles.botonDesactivado,
              ]}
              onPress={buscarDireccion}
              disabled={buscando}
            >
              {buscando ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <View style={styles.botonMapaFila}>
                  <Ionicons
                    name="search"
                    size={18}
                    color="#FFFFFF"
                  />

                  <Text style={styles.textoBoton}>
                    Buscar dirección
                  </Text>
                </View>
              )}
            </TouchableOpacity>

          </View>
        )}

        {/* FORMULARIO */}

        <View style={styles.panel}>

          <Text style={styles.panelTitulo}>
            Nombre del lugar
          </Text>

          <Text style={styles.panelTexto}>
            Dale un nombre para reconocerlo fácilmente.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="Ej: Casa, Universidad, Trabajo..."
            placeholderTextColor="#777777"
            value={nombre}
            onChangeText={setNombre}
            returnKeyType="done"
            onSubmitEditing={Keyboard.dismiss}
          />

          <TouchableOpacity
            style={[
              styles.botonGuardar,
              guardando && styles.botonDesactivado,
            ]}
            onPress={guardarDireccion}
            disabled={guardando}
          >
            {guardando ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <View style={styles.botonMapaFila}>
                <Ionicons
                  name="bookmark-outline"
                  size={18}
                  color="#FFFFFF"
                />

                <Text style={styles.textoBoton}>
                  Guardar lugar
                </Text>
              </View>
            )}
          </TouchableOpacity>

        </View>

        {/* MIS LUGARES */}

        <Text style={styles.tituloLugares}>
          Mis lugares guardados
        </Text>

        {cargando ? (
          <ActivityIndicator
            size="large"
            color="#2F6B4F"
            style={styles.cargando}
          />
        ) : direcciones.length === 0 ? (
          <View style={styles.vacio}>

            <Ionicons
              name="location-outline"
              size={40}
              color="#000000"
              style={styles.vacioIcono}
            />

            <Text style={styles.vacioTitulo}>
              Todavía no tienes lugares
            </Text>

            <Text style={styles.vacioTexto}>
              Selecciona un punto del mapa o escribe una dirección para comenzar.
            </Text>

          </View>
        ) : (
          direcciones.map((item) => (
            <View
              key={item.id}
              style={styles.tarjeta}
            >

              <TouchableOpacity
                style={styles.infoTarjeta}
                onPress={() => mostrarDireccionGuardada(item)}
              >
                <View style={styles.iconoLugar}>
                  <Ionicons
                    name="location"
                    size={22}
                    color="#12343F"
                  />
                </View>

                <View style={styles.textosTarjeta}>
                  <Text style={styles.nombreLugar}>
                    {item.nombre}
                  </Text>

                  <Text
                    style={styles.direccionLugar}
                    numberOfLines={2}
                  >
                    {item.direccion}
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.botonEliminar}
                onPress={() => eliminarDireccion(item.id)}
              >
                <Ionicons
                  name="trash-outline"
                  size={21}
                  color="#A33A3A"
                />
              </TouchableOpacity>

            </View>
          ))
        )}

        <View style={styles.espacioFinal} />

      </ScrollView>

    </KeyboardAvoidingView>
  );
}

// ============================================================
// ESTILOS
// ============================================================

const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
});

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F6F4EF",
  },

  encabezado: {
    backgroundColor: "#0D2832",
    paddingHorizontal: 20,
    paddingTop: 26,
    paddingBottom: 22,
    borderBottomWidth: 3,
    borderBottomColor: "#A8803A",
    marginBottom: 14,
  },

  titulo: {
    fontSize: 30,
    fontWeight: "700",
    color: "#FFFFFF",
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  subtitulo: {
    marginTop: 4,
    fontSize: 13,
    color: "#FFFFFF",
    letterSpacing: 0.2,
  },

  botonMapaFila: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },

  mapaOculto: {
    height: 0,
    marginTop: 0,
    marginBottom: 0,
    borderWidth: 0,
    opacity: 0,
  },

  mapaContainer: {
    height: 280,
    marginHorizontal: 15,
    borderRadius: 22,
    overflow: "hidden",
    position: "relative",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 4,
  },

  mapa: {
    flex: 1,
  },

  // BOTONES DE SERVICIOS (a la derecha)

  botonesServicios: {
    position: "absolute",
    top: 12,
    right: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },

  botonServicio: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "#DADADA",
    elevation: 4,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 5,
  },

  botonServicioActivo: {
    backgroundColor: "#E8F0EB",
    borderColor: "#245B45",
  },

  textoServicio: {
    color: "#000000",
    fontSize: 12,
    fontWeight: "700",
  },

  notaMapa: {
    color: "#000000",
    fontSize: 11,
    lineHeight: 16,
    marginHorizontal: 18,
    marginTop: 8,
    marginBottom: 3,
  },

  botonCentrar: {
    position: "absolute",
    right: 15,
    bottom: 15,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    elevation: 4,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },

  botonCentrarTexto: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "bold",
    letterSpacing: 0.3,
  },

  contenido: {
    flex: 1,
    paddingHorizontal: 15,
  },

  tituloSeccion: {
    marginTop: 18,
    marginBottom: 12,
    fontSize: 19,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  opciones: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 15,
  },

  opcion: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    borderRadius: 18,
    padding: 16,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  opcionSeleccionada: {
    borderColor: "#12343F",
    backgroundColor: "#EEF3F2",
    borderWidth: 1.5,
  },

  opcionIcono: {
    marginBottom: 10,
  },

  opcionTitulo: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000000",
  },

  opcionTituloSeleccionado: {
    color: "#000000",
  },

  opcionTexto: {
    marginTop: 4,
    fontSize: 12,
    color: "#000000",
  },

  panel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 18,
    marginBottom: 15,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },

  panelTitulo: {
    fontSize: 18,
    fontWeight: "700",
    color: "#000000",
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  panelTexto: {
    marginTop: 5,
    marginBottom: 12,
    fontSize: 13,
    color: "#000000",
    lineHeight: 18,
  },

  ubicacionSeleccionada: {
    backgroundColor: "#E6F0EA",
    padding: 14,
    borderRadius: 14,
    marginTop: 5,
  },

  ubicacionTitulo: {
    fontSize: 14,
    fontWeight: "bold",
    color: "#000000",
  },

  ubicacionTexto: {
    marginTop: 6,
    fontSize: 12,
    color: "#000000",
  },

  input: {
    backgroundColor: "#FBFAF7",
    borderWidth: 1,
    borderColor: "#D9D3C5",
    borderRadius: 14,
    paddingHorizontal: 15,
    paddingVertical: 13,
    fontSize: 15,
    color: "#000000",
    marginBottom: 12,
  },

  botonBuscar: {
    backgroundColor: "#12343F",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#A8803A",
  },

  botonGuardar: {
    backgroundColor: "#2F6B4F",
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 5,
  },

  botonDesactivado: {
    opacity: 0.6,
  },

  textoBoton: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "bold",
    letterSpacing: 0.4,
  },

  tituloLugares: {
    fontSize: 21,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 12,
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  tarjeta: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 15,
    marginBottom: 10,
    flexDirection: "row",
    alignItems: "center",
    elevation: 2,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },

  infoTarjeta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
  },

  iconoLugar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  iconoLugarTexto: {
    fontSize: 20,
  },

  textosTarjeta: {
    flex: 1,
  },

  nombreLugar: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000000",
    fontFamily: SERIF,
  },

  direccionLugar: {
    marginTop: 4,
    fontSize: 12,
    color: "#000000",
    lineHeight: 17,
  },

  botonEliminar: {
    padding: 10,
    marginLeft: 5,
    borderRadius: 12,
    backgroundColor: "#FBEFEF",
  },

  textoEliminar: {
    fontSize: 18,
  },

  vacio: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 25,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E6E1D6",
  },

  vacioIcono: {
    marginBottom: 10,
  },

  vacioTitulo: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#000000",
  },

  vacioTexto: {
    marginTop: 6,
    textAlign: "center",
    fontSize: 13,
    color: "#000000",
    lineHeight: 19,
  },

  cargando: {
    marginTop: 20,
  },

  espacioFinal: {
    height: 30,
  },

});