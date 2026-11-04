
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { Platform } from "react-native";

import {
  collection,
  doc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";

import { db } from "../firebaseConfig";

// =====================================
// CONFIGURACIÓN DE NOTIFICACIONES
// =====================================

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// =====================================
// CONFIGURAR CANAL DE ANDROID
// =====================================

const configurarCanalNotificaciones = async () => {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(
      "default",
      {
        name: "Notificaciones de La Esperanza",
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: "#A8803A",
      }
    );
  }
};

// =====================================
// SOLICITAR PERMISOS
// =====================================

const solicitarPermisos = async () => {
  const permisos = await Notifications.getPermissionsAsync();

  let estado = permisos.status;

  if (estado !== "granted") {
    const resultado =
      await Notifications.requestPermissionsAsync();

    estado = resultado.status;
  }

  return estado === "granted";
};

// =====================================
// MOSTRAR NOTIFICACIÓN LOCAL
// =====================================

const mostrarNotificacion = async (
  titulo,
  mensaje,
  tipo
) => {
  try {
    await configurarCanalNotificaciones();

    const permisoConcedido = await solicitarPermisos();

    if (!permisoConcedido) {
      console.log(
        "No se concedieron permisos de notificación."
      );

      return false;
    }

    await Notifications.scheduleNotificationAsync({
      content: {
        title: titulo,
        body: mensaje,
        sound: "default",
        data: {
          tipo,
        },
      },
      trigger: null,
    });

    console.log(
      `Notificación "${tipo}" programada correctamente.`
    );

    return true;

  } catch (error) {
    console.error(
      `Error mostrando notificación ${tipo}:`,
      error
    );

    return false;
  }
};

// =====================================
// REGISTRAR TOKEN PUSH DEL DISPOSITIVO
// =====================================

export const registrarNotificaciones = async (usuarioId) => {
  try {
    if (!Device.isDevice) {
      console.log(
        "Se necesita un dispositivo físico."
      );

      return null;
    }

    if (!usuarioId) {
      console.log(
        "No se encontró el ID del usuario."
      );

      return null;
    }

    await configurarCanalNotificaciones();

    const permisoConcedido = await solicitarPermisos();

    if (!permisoConcedido) {
      console.log(
        "Permiso de notificaciones denegado."
      );

      return null;
    }

    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ||
      Constants.easConfig?.projectId;

    if (!projectId) {
      throw new Error(
        "No se encontró el projectId de Expo."
      );
    }

    const respuesta =
      await Notifications.getExpoPushTokenAsync({
        projectId,
      });

    const token = respuesta.data;

    // Guardar un documento por dispositivo y usuario.
    await setDoc(
      doc(
        collection(
          db,
          "usuarios",
          usuarioId,
          "tokensNotificaciones"
        ),
        encodeURIComponent(token)
      ),
      {
        token,
        plataforma: Platform.OS,
        activo: true,
        actualizadoEn: serverTimestamp(),
      },
      {
        merge: true,
      }
    );

    console.log(
      "Token registrado correctamente."
    );

    return token;

  } catch (error) {
    console.error(
      "Error registrando el dispositivo:",
      error
    );

    return null;
  }
};

// =====================================
// NOTIFICACIÓN DE REGISTRO
// =====================================

export const notificarRegistroExitoso = async (nombre) => {
  return await mostrarNotificacion(
    "¡Bienvenido a La Esperanza!",
    `Hola ${nombre}, tu cuenta fue creada correctamente. Ya puedes comenzar a participar.`,
    "registro"
  );
};

// =====================================
// NOTIFICACIÓN DE INICIO DE SESIÓN
// =====================================

export const notificarInicioSesion = async (correo) => {
  return await mostrarNotificacion(
    "¡Inicio de sesión exitoso!",
    `Has iniciado sesión correctamente con ${correo}. ¡Bienvenido de nuevo!`,
    "inicio_sesion"
  );
};

// =====================================
// NOTIFICACIÓN DE DONACIÓN
// =====================================

export const notificarDonacionRegistrada = async (valor) => {
  const monto = Number(valor);

  if (!Number.isFinite(monto) || monto < 1000) {
    console.log(
      "No se puede notificar un monto inválido."
    );

    return false;
  }

  const montoFormateado = monto.toLocaleString("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  });

  return await mostrarNotificacion(
    "¡Gracias por tu solidaridad!",
    `Tu donación de ${montoFormateado} fue registrada correctamente en La Esperanza.`,
    "donacion"
  );
};
