
import { useState } from "react";

import {
  ActivityIndicator,
  Alert,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import * as Notifications from "expo-notifications";

import { auth, db } from "../firebaseConfig.js";

import {
  addDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";

// Configuración de las notificaciones
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function Help() {
  const [tipoAyuda, setTipoAyuda] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);

  const tiposAyuda = [
    { nombre: "Médicos", icono: "medkit-outline" },
    { nombre: "Primeros auxilios", icono: "medical-outline" },
    { nombre: "Voluntarios", icono: "people-outline" },
    { nombre: "Rescate", icono: "shield-checkmark-outline" },
    { nombre: "Alimentos", icono: "restaurant-outline" },
    { nombre: "Agua y suministros", icono: "water-outline" },
    { nombre: "Refugio", icono: "home-outline" },
    { nombre: "Otro", icono: "help-circle-outline" },
  ];

  // Solicitar permisos y mostrar notificación local
  const notificarSolicitud = async (tipo) => {
    try {
      // Consultar permisos actuales
      let permisos = await Notifications.getPermissionsAsync();

      // Solicitar permisos si todavía no están concedidos
      if (!permisos.granted) {
        permisos = await Notifications.requestPermissionsAsync();
      }

      // Si el usuario no concede permisos, no interrumpimos el proceso
      if (!permisos.granted) {
        console.log("El usuario no autorizó las notificaciones.");
        return;
      }

      // Configurar canal para Android
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("solicitudes", {
          name: "Solicitudes de ayuda",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          sound: "default",
        });
      }

      // Crear notificación local
      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Solicitud enviada correctamente",
          body: `Tu solicitud de ${tipo} se registró correctamente.`,
          sound: "default",
          data: {
            pantalla: "Help",
            tipoAyuda: tipo,
          },
        },
        trigger: null,
      });

      console.log("Notificación de solicitud enviada.");
    } catch (error) {
      console.log("Error al mostrar la notificación:", error);
    }
  };

  // Enviar solicitud a Firebase
  const enviarSolicitud = async () => {
    if (!tipoAyuda) {
      Alert.alert(
        "Falta información",
        "Selecciona el tipo de ayuda que necesitas."
      );
      return;
    }

    if (!descripcion.trim()) {
      Alert.alert(
        "Falta información",
        "Describe qué tipo de ayuda necesitas."
      );
      return;
    }

    const usuarioActual = auth.currentUser;

    if (!usuarioActual) {
      Alert.alert(
        "No has iniciado sesión",
        "Debes iniciar sesión para enviar una solicitud."
      );
      return;
    }

    try {
      setGuardando(true);

      // Guardar solicitud en Firestore
      const solicitud = await addDoc(
        collection(db, "solicitudes"),
        {
          usuarioId: usuarioActual.uid,
          tipoAyuda,
          descripcion: descripcion.trim(),
          estado: "Pendiente",
          fecha: serverTimestamp(),
        }
      );

      console.log("Solicitud guardada:", solicitud.id);

      // Mostrar notificación únicamente en este dispositivo
      await notificarSolicitud(tipoAyuda);

      // Confirmación en pantalla
      Alert.alert(
        "Solicitud enviada",
        "Tu solicitud se registró correctamente. Recibirás una notificación en este dispositivo."
      );

      // Limpiar formulario
      setTipoAyuda("");
      setDescripcion("");

    } catch (error) {
      console.log("Error al guardar solicitud:", error);

      Alert.alert(
        "Error",
        "No fue posible guardar la solicitud. Verifica tu conexión e inténtalo nuevamente."
      );
    } finally {
      setGuardando(false);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.header}>
        <View style={styles.iconHeader}>
          <Ionicons
            name="alert-circle-outline"
            size={50}
            color="#FFFFFF"
          />
        </View>

        <Text style={styles.title}>Solicitar ayuda</Text>
      </View>

      <View style={styles.infoBox}>
        <Ionicons
          name="information-circle-outline"
          size={24}
          color="#12343F"
        />

        <Text style={styles.infoText}>
          Selecciona el tipo de ayuda que necesitas y explica
          brevemente la situación.
        </Text>
      </View>

      <Text style={styles.sectionTitle}>
        ¿Qué tipo de ayuda necesitas?
      </Text>

      <View style={styles.optionsContainer}>
        {tiposAyuda.map((tipo) => {
          const seleccionado = tipoAyuda === tipo.nombre;

          return (
            <TouchableOpacity
              key={tipo.nombre}
              style={[
                styles.option,
                seleccionado && styles.optionSelected,
              ]}
              onPress={() => setTipoAyuda(tipo.nombre)}
              activeOpacity={0.8}
            >
              <Ionicons
                name={tipo.icono}
                size={25}
                color={seleccionado ? "#FFFFFF" : "#12343F"}
              />

              <Text
                style={[
                  styles.optionText,
                  seleccionado && styles.optionTextSelected,
                ]}
              >
                {tipo.nombre}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>
        Describe lo que necesitas
      </Text>

      <TextInput
        style={styles.textArea}
        placeholder="Ejemplo: Necesitamos médicos para atender a varias personas en la zona..."
        placeholderTextColor="#98A3A6"
        multiline
        numberOfLines={6}
        maxLength={500}
        value={descripcion}
        onChangeText={setDescripcion}
        textAlignVertical="top"
        editable={!guardando}
      />

      <Text style={styles.counter}>
        {descripcion.length}/500 caracteres
      </Text>

      <TouchableOpacity
        style={[
          styles.button,
          guardando && styles.buttonDisabled,
        ]}
        onPress={enviarSolicitud}
        disabled={guardando}
        activeOpacity={0.8}
      >
        {guardando ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            <Ionicons
              name="send-outline"
              size={22}
              color="#FFFFFF"
            />

            <Text style={styles.buttonText}>
              Enviar solicitud
            </Text>
          </>
        )}
      </TouchableOpacity>

      <View style={styles.warningBox}>
        <Ionicons
          name="warning-outline"
          size={30}
          color="#12343F"
        />

        <Text style={styles.warningText}>
          En una emergencia que represente un peligro inmediato
          para la vida, comunícate también con los servicios de
          emergencia de tu localidad.
        </Text>
      </View>
    </ScrollView>
  );
}

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

  content: {
    padding: 22,
    paddingBottom: 48,
    paddingTop: 28,
  },

  header: {
    alignItems: "center",
    marginBottom: 20,
  },

  iconHeader: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: "#12343F",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 14,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 4,
  },

  title: {
    fontSize: 28,
    fontWeight: "700",
    color: "#12242B",
    textAlign: "center",
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F6EFE0",
    borderRadius: 16,
    padding: 16,
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#E8DCC0",
  },

  infoText: {
    flex: 1,
    fontSize: 14,
    color: "#3B4A50",
    marginLeft: 10,
    lineHeight: 20,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#12242B",
    marginBottom: 12,
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  optionsContainer: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 25,
  },

  option: {
    width: "48%",
    minHeight: 96,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    justifyContent: "center",
    alignItems: "center",
    padding: 10,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 2,
  },

  optionSelected: {
    backgroundColor: "#12343F",
    borderColor: "#12343F",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  optionText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#2C3B41",
    marginTop: 7,
    textAlign: "center",
    letterSpacing: 0.2,
  },

  optionTextSelected: {
    color: "#FFFFFF",
  },

  textArea: {
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#D9D3C5",
    borderRadius: 18,
    minHeight: 140,
    padding: 16,
    fontSize: 15,
    color: "#2C3B41",
    marginBottom: 5,
  },

  counter: {
    textAlign: "right",
    color: "#7C898D",
    fontSize: 12,
    marginBottom: 20,
  },

  button: {
    minHeight: 56,
    backgroundColor: "#12343F",
    borderRadius: 16,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
    marginBottom: 20,
    borderBottomWidth: 2,
    borderBottomColor: "#A8803A",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  buttonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  warningBox: {
    flexDirection: "row",
    backgroundColor: "#F6EFE0",
    borderRadius: 16,
    padding: 16,
    alignItems: "flex-start",
    borderWidth: 1,
    borderColor: "#E8DCC0",
  },

  warningText: {
    flex: 1,
    color: "#7A5A1E",
    fontSize: 13,
    lineHeight: 19,
    marginLeft: 9,
  },
});
