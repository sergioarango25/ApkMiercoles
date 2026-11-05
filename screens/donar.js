
import { useEffect, useState } from "react";

import LogoAra from "../assets/img/Logo-ara.svg";
import LogoD1 from "../assets/img/Logo-d1.svg";
import LogoExito from "../assets/img/Logo-exito.svg";

import * as Notifications from "expo-notifications";

import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import {
  addDoc,
  collection,
  onSnapshot,
  serverTimestamp,
  where,
  query,
} from "firebase/firestore";

import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "../firebaseConfig";

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

const Donar = () => {
  const [activeView, setActiveView] = useState("money");

  const [selectedAmount, setSelectedAmount] = useState("50000");
  const [customAmount, setCustomAmount] = useState("");
  const [donorName, setDonorName] = useState("");
  const [note, setNote] = useState("");

  const [user, setUser] = useState(null);
  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const amounts = [
    { value: "20000", label: "$20.000" },
    { value: "50000", label: "$50.000" },
    { value: "100000", label: "$100.000" },
    { value: "200000", label: "$200.000" },
  ];

  // Detectar usuario autenticado
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      if (currentUser) {
        setDonorName(currentUser.displayName || "");
      } else {
        setDonorName("");
        setDonations([]);
        setLoading(false);
      }
    });

    return unsubscribeAuth;
  }, []);

  // Cargar las donaciones del usuario
  useEffect(() => {
    if (!user) {
      setDonations([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const donationsQuery = query(
      collection(db, "donaciones"),
      where("usuarioId", "==", user.uid)
    );

    const unsubscribe = onSnapshot(
      donationsQuery,
      (snapshot) => {
        const donationsData = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        donationsData.sort((a, b) => {
          const fechaA = a.fecha?.toDate
            ? a.fecha.toDate().getTime()
            : 0;

          const fechaB = b.fecha?.toDate
            ? b.fecha.toDate().getTime()
            : 0;

          return fechaB - fechaA;
        });

        setDonations(donationsData);
        setLoading(false);
      },
      (error) => {
        console.error("Error al cargar donaciones:", error);
        setLoading(false);

        Alert.alert(
          "Error al cargar el balance",
          "No pudimos consultar tus donaciones. Revisa tu conexión y los permisos de Firestore."
        );
      }
    );

    return unsubscribe;
  }, [user]);

  // Formatear valores monetarios
  const formatMoney = (value) => {
    return Number(value || 0).toLocaleString("es-CO", {
      style: "currency",
      currency: "COP",
      maximumFractionDigits: 0,
    });
  };

  // Calcular total donado
  const totalDonated = donations.reduce(
    (total, item) => total + (Number(item.monto) || 0),
    0
  );

  // Obtener monto seleccionado
  const getCurrentDonationValue = () => {
    const rawValue =
      selectedAmount === "custom"
        ? customAmount
        : selectedAmount;

    const normalizedValue = String(rawValue).replace(/[.\s,$]/g, "");

    if (!/^\d+$/.test(normalizedValue)) {
      return 0;
    }

    return Number(normalizedValue);
  };

  // Seleccionar monto
  const handleSelectAmount = (value) => {
    setSelectedAmount(value);
    setCustomAmount("");
  };

  // Validar monto personalizado
  const handleCustomAmountChange = (text) => {
    const digitsOnly = text.replace(/\D/g, "");

    setCustomAmount(digitsOnly);
    setSelectedAmount("custom");
  };

  // Mostrar notificación local
  const notificarDonacion = async (monto) => {
    try {
      let permisos = await Notifications.getPermissionsAsync();

      if (!permisos.granted) {
        permisos = await Notifications.requestPermissionsAsync();
      }

      if (!permisos.granted) {
        console.log("El usuario no autorizó las notificaciones.");
        return;
      }

      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync(
          "donaciones",
          {
            name: "Donaciones",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: "default",
          }
        );
      }

      await Notifications.scheduleNotificationAsync({
        content: {
          title: "Donación registrada",
          body: `Tu donación de ${formatMoney(monto)} se guardó correctamente.`,
          sound: "default",
          data: {
            pantalla: "Balance",
            monto,
          },
        },
        trigger: null,
      });
    } catch (error) {
      console.log("Error al mostrar notificación:", error);
    }
  };

  // Guardar donación
  const handleSaveDonation = async () => {
    if (!user) {
      Alert.alert(
        "Inicia sesión",
        "Debes iniciar sesión para registrar una donación."
      );
      return;
    }

    const amount = getCurrentDonationValue();
    const cleanName = donorName.trim();
    const cleanNote = note.trim();

    if (!cleanName) {
      Alert.alert(
        "Falta tu nombre",
        "Escribe el nombre del donante."
      );
      return;
    }

    if (!Number.isSafeInteger(amount) || amount < 1000) {
      Alert.alert(
        "Monto inválido",
        "Ingresa un monto mínimo de $1.000 COP."
      );
      return;
    }

    if (cleanNote.length > 250) {
      Alert.alert(
        "Mensaje muy largo",
        "El mensaje debe tener máximo 250 caracteres."
      );
      return;
    }

    Alert.alert(
      "Confirmar donación",
      `Vas a registrar una donación de ${formatMoney(amount)}. Este formulario registra la donación, pero no realiza un pago real.`,
      [
        {
          text: "Revisar",
          style: "cancel",
        },
        {
          text: "Confirmar",
          onPress: async () => {
            if (saving) return;

            try {
              setSaving(true);

              await addDoc(collection(db, "donaciones"), {
                usuarioId: user.uid,
                nombreDonante: cleanName,
                correo: user.email || "",
                monto: amount,
                moneda: "COP",
                nota: cleanNote,
                estado: "Registrada",
                fecha: serverTimestamp(),
              });

              await notificarDonacion(amount);

              setCustomAmount("");
              setSelectedAmount("50000");
              setNote("");

              Alert.alert(
                "Donación registrada",
                "Tu donación quedó guardada correctamente. Ya puedes consultarla en Balance."
              );
            } catch (error) {
              console.error("Error al guardar donación:", error);

              Alert.alert(
                "No se pudo guardar",
                "Verifica tu conexión, tu sesión y las reglas de Firestore."
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  // Formatear fecha
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return "Fecha pendiente";
    }

    return timestamp.toDate().toLocaleDateString("es-CO", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  // Abrir página de un comercio
  const abrirComercio = async (url) => {
    try {
      await Linking.openURL(url);
    } catch (error) {
      Alert.alert(
        "No se pudo abrir",
        "No fue posible abrir la página del comercio."
      );
    }
  };

  // Tarjetas de comercios
  const renderComercio = (nombre, descripcion, Logo, url) => (
    <View style={styles.comercioCard}>
      <View style={styles.comercioLogo}>
        <Logo width={65} height={55} />
      </View>

      <View style={styles.comercioInfo}>
        <Text style={styles.comercioNombre}>{nombre}</Text>

        <Text style={styles.comercioDescripcion}>
          {descripcion}
        </Text>

        <TouchableOpacity
          style={styles.comercioButton}
          onPress={() => abrirComercio(url)}
          activeOpacity={0.8}
        >
          <Text style={styles.comercioButtonText}>
            Visitar tienda
          </Text>

          <Text style={styles.comercioArrow}>›</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Encabezado */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Apoyemos juntos</Text>

        <Text style={styles.headerSubtitle}>
          Cada aporte puede marcar una diferencia.
        </Text>
      </View>

      {/* Navegación */}
      <View style={styles.navigation}>
        <TouchableOpacity
          style={[
            styles.navigationButton,
            activeView === "money" && styles.navigationActive,
          ]}
          onPress={() => setActiveView("money")}
        >
          <Text
            style={[
              styles.navigationText,
              activeView === "money" && styles.navigationTextActive,
            ]}
          >
            Dinero
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navigationButton,
            activeView === "supplies" && styles.navigationActive,
          ]}
          onPress={() => setActiveView("supplies")}
        >
          <Text
            style={[
              styles.navigationText,
              activeView === "supplies" && styles.navigationTextActive,
            ]}
          >
            Insumos
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.navigationButton,
            activeView === "balance" && styles.navigationActive,
          ]}
          onPress={() => setActiveView("balance")}
        >
          <Text
            style={[
              styles.navigationText,
              activeView === "balance" && styles.navigationTextActive,
            ]}
          >
            Balance
          </Text>
        </TouchableOpacity>
      </View>

      {/* DINERO */}
      {activeView === "money" && (
        <View style={styles.mainCard}>
          <Text style={styles.sectionTitle}>
            Realizar una donación
          </Text>

          <Text style={styles.helperText}>
            Selecciona cuánto deseas aportar para ayudar a las personas
            afectadas.
          </Text>

          <View style={styles.amountGrid}>
            {amounts.map((item) => {
              const selected = selectedAmount === item.value;

              return (
                <TouchableOpacity
                  key={item.value}
                  style={[
                    styles.amountCard,
                    selected && styles.amountCardSelected,
                  ]}
                  onPress={() => handleSelectAmount(item.value)}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.amountText,
                      selected && styles.amountTextSelected,
                    ]}
                  >
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.label}>Otro monto (COP)</Text>

          <TextInput
            style={[
              styles.input,
              selectedAmount === "custom" && styles.inputFocused,
            ]}
            placeholder="Ej. 30000"
            placeholderTextColor="#777777"
            value={customAmount}
            onChangeText={handleCustomAmountChange}
            keyboardType="number-pad"
            maxLength={12}
            returnKeyType="done"
          />

          <Text style={styles.label}>Nombre del donante *</Text>

          <TextInput
            style={styles.input}
            placeholder="Escribe tu nombre"
            placeholderTextColor="#777777"
            value={donorName}
            onChangeText={setDonorName}
            autoCapitalize="words"
            maxLength={80}
            returnKeyType="next"
          />

          <Text style={styles.label}>Mensaje (opcional)</Text>

          <TextInput
            style={[styles.input, styles.noteInput]}
            placeholder="Deja un mensaje de apoyo..."
            placeholderTextColor="#777777"
            value={note}
            onChangeText={setNote}
            maxLength={250}
            multiline
          />

          <Text style={styles.disclaimer}>
            Este formulario registra tu intención de donar. No procesa
            pagos ni solicita datos bancarios.
          </Text>

          <TouchableOpacity
            style={[
              styles.submitButton,
              saving && styles.buttonDisabled,
            ]}
            onPress={handleSaveDonation}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color="#000000" />
            ) : (
              <Text style={styles.submitButtonText}>
                Guardar donación
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* INSUMOS */}
      {activeView === "supplies" && (
        <View style={styles.mainCard}>
          <View style={styles.suppliesHeader}>
            <View style={styles.suppliesIcon}>
              <Text style={styles.suppliesIconText}>+</Text>
            </View>

            <View style={styles.suppliesHeaderInfo}>
              <Text style={styles.sectionTitle}>
                Donación de insumos
              </Text>

              <Text style={styles.helperText}>
                Encuentra productos básicos para apoyar a quienes lo
                necesitan.
              </Text>
            </View>
          </View>

          <View style={styles.suppliesMessage}>
            <Text style={styles.suppliesMessageTitle}>
              ¿Qué puedes aportar?
            </Text>

            <Text style={styles.suppliesMessageText}>
              Agua, alimentos no perecederos, productos de higiene y
              artículos de primera necesidad.
            </Text>
          </View>

          <Text style={styles.storeSectionTitle}>
            Comercios disponibles
          </Text>

          <View style={styles.storeList}>
            {renderComercio(
              "Tiendas D1",
              "Productos de alimentación y aseo.",
              LogoD1,
              "https://www.d1.com.co/"
            )}

            {renderComercio(
              "Tiendas Ara",
              "Artículos básicos para el hogar.",
              LogoAra,
              "https://www.tiendasara.com/"
            )}

            {renderComercio(
              "Supermercados Éxito",
              "Alimentos y productos de primera necesidad.",
              LogoExito,
              "https://www.exito.com/"
            )}
          </View>

          <Text style={styles.suppliesFooter}>
            Recuerda verificar los puntos de recepción de donaciones
            antes de entregar tus productos.
          </Text>
        </View>
      )}

      {/* BALANCE */}
      {activeView === "balance" && (
        <View>
          {!user ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>
                Inicia sesión para consultar tu balance
              </Text>

              <Text style={styles.emptyText}>
                Tu historial de donaciones estará disponible cuando
                ingreses a tu cuenta.
              </Text>
            </View>
          ) : (
            <>
              <View style={styles.balanceCard}>
                <Text style={styles.balanceLabel}>
                  TOTAL DE MIS DONACIONES
                </Text>

                <Text style={styles.balanceValue}>
                  {formatMoney(totalDonated)}
                </Text>

                <View style={styles.balanceDivider} />

                <View style={styles.balanceFooter}>
                  <View>
                    <Text style={styles.balanceSmallLabel}>
                      Donaciones realizadas
                    </Text>

                    <Text style={styles.balanceCount}>
                      {donations.length}
                    </Text>
                  </View>

                  <View style={styles.balanceIcon}>
                    <Text style={styles.balanceIconText}>$</Text>
                  </View>
                </View>
              </View>

              <View style={styles.historyCard}>
                <View style={styles.historyHeader}>
                  <View>
                    <Text style={styles.sectionTitle}>
                      Mi historial
                    </Text>

                    <Text style={styles.helperText}>
                      Consulta tus aportes registrados.
                    </Text>
                  </View>
                </View>

                {loading ? (
                  <View style={styles.loadingContainer}>
                    <ActivityIndicator
                      size="large"
                      color="#000000"
                    />

                    <Text style={styles.emptyText}>
                      Cargando tus donaciones...
                    </Text>
                  </View>
                ) : donations.length === 0 ? (
                  <View style={styles.emptyHistory}>
                    <Text style={styles.emptyHistoryIcon}>$</Text>

                    <Text style={styles.emptyTitle}>
                      Aún no tienes donaciones
                    </Text>

                    <Text style={styles.emptyText}>
                      Cuando registres tu primera donación, aparecerá
                      aquí.
                    </Text>

                    <TouchableOpacity
                      style={styles.emptyButton}
                      onPress={() => setActiveView("money")}
                    >
                      <Text style={styles.emptyButtonText}>
                        Realizar mi primera donación
                      </Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  donations.map((item) => (
                    <View
                      key={item.id}
                      style={styles.historyItem}
                    >
                      <View style={styles.historyIcon}>
                        <Text style={styles.historyIconText}>$</Text>
                      </View>

                      <View style={styles.historyInfo}>
                        <Text style={styles.historyAmount}>
                          {formatMoney(item.monto)}
                        </Text>

                        <Text style={styles.historyDate}>
                          {formatDate(item.fecha)}
                        </Text>

                        {!!item.nota && (
                          <Text style={styles.historyNote}>
                            {item.nota}
                          </Text>
                        )}
                      </View>

                      <View style={styles.statusContainer}>
                        <Text style={styles.historyStatus}>
                          {item.estado || "Registrada"}
                        </Text>
                      </View>
                    </View>
                  ))
                )}
              </View>
            </>
          )}
        </View>
      )}
    </ScrollView>
  );
};

// Todos los textos utilizan negro sólido, sin contornos ni sombras.
const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia",
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F4EF",
  },

  container: {
    padding: 20,
    paddingBottom: 40,
  },

  header: {
    marginBottom: 20,
    marginTop: 8,
  },

  headerTitle: {
    color: "#000000",
    fontSize: 25,
    fontWeight: "800",
    fontFamily: SERIF,
  },

  headerSubtitle: {
    color: "#000000",
    fontSize: 13,
    marginTop: 5,
  },

  navigation: {
    flexDirection: "row",
    backgroundColor: "#EAE7DF",
    borderRadius: 15,
    padding: 4,
    marginBottom: 18,
  },

  navigationButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },

  navigationActive: {
    backgroundColor: "#FFFFFF",
    elevation: 2,
  },

  navigationText: {
    fontSize: 13,
    fontWeight: "600",
    color: "#000000",
  },

  navigationTextActive: {
    color: "#000000",
    fontWeight: "800",
  },

  mainCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    elevation: 2,
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: "700",
    color: "#000000",
    marginBottom: 7,
    fontFamily: SERIF,
  },

  helperText: {
    color: "#000000",
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 15,
  },

  amountGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    marginBottom: 8,
  },

  amountCard: {
    width: "48%",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    marginBottom: 10,
  },

  amountCardSelected: {
    backgroundColor: "#F6EFE0",
    borderColor: "#A8803A",
    borderWidth: 1.5,
  },

  amountText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#000000",
  },

  amountTextSelected: {
    color: "#000000",
  },

  label: {
    fontSize: 13,
    fontWeight: "700",
    color: "#000000",
    marginTop: 9,
    marginBottom: 7,
  },

  input: {
    borderWidth: 1,
    borderColor: "#D9D3C5",
    borderRadius: 13,
    paddingHorizontal: 13,
    paddingVertical: 13,
    fontSize: 14,
    color: "#000000",
    backgroundColor: "#FFFFFF",
  },

  inputFocused: {
    borderColor: "#A8803A",
    backgroundColor: "#FCFAF5",
  },

  noteInput: {
    minHeight: 75,
    textAlignVertical: "top",
  },

  disclaimer: {
    color: "#000000",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 13,
    marginBottom: 15,
  },

  submitButton: {
    width: "100%",
    paddingVertical: 15,
    backgroundColor: "#12343F",
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#A8803A",
  },

  buttonDisabled: {
    opacity: 0.6,
  },

  submitButtonText: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "700",
  },

  // Insumos
  suppliesHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
  },

  suppliesIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: "#EAF0EA",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },

  suppliesIconText: {
    color: "#000000",
    fontSize: 27,
    fontWeight: "400",
  },

  suppliesHeaderInfo: {
    flex: 1,
  },

  suppliesMessage: {
    backgroundColor: "#F4F5EF",
    borderRadius: 14,
    padding: 15,
    marginBottom: 20,
  },

  suppliesMessageTitle: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 5,
  },

  suppliesMessageText: {
    color: "#000000",
    fontSize: 12,
    lineHeight: 19,
  },

  storeSectionTitle: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 12,
  },

  storeList: {
    gap: 11,
  },

  comercioCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FAFAF7",
    borderWidth: 1,
    borderColor: "#EEECE5",
    borderRadius: 15,
    padding: 12,
  },

  comercioLogo: {
    width: 82,
    height: 76,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  comercioInfo: {
    flex: 1,
  },

  comercioNombre: {
    fontSize: 14,
    fontWeight: "700",
    color: "#000000",
  },

  comercioDescripcion: {
    color: "#000000",
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },

  comercioButton: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 7,
  },

  comercioButtonText: {
    color: "#000000",
    fontSize: 12,
    fontWeight: "700",
  },

  comercioArrow: {
    color: "#000000",
    fontSize: 20,
    marginLeft: 4,
    marginTop: -2,
  },

  suppliesFooter: {
    color: "#000000",
    fontSize: 11,
    lineHeight: 17,
    marginTop: 17,
  },

  // Balance
  balanceCard: {
    backgroundColor: "#ffffff",
    borderRadius: 21,
    padding: 22,
    marginBottom: 17,
    borderBottomWidth: 3,
    borderBottomColor: "#A8803A",
    elevation: 2,
  },

  balanceLabel: {
    color: "#000000",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },

  balanceValue: {
    color: "#000000",
    fontSize: 30,
    fontWeight: "800",
    marginTop: 9,
    fontFamily: SERIF,
  },

  balanceDivider: {
    height: 1,
    backgroundColor: "#AAAAAA",
    marginVertical: 17,
  },

  balanceFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },

  balanceSmallLabel: {
    color: "#000000",
    fontSize: 11,
  },

  balanceCount: {
    color: "#000000",
    fontSize: 21,
    fontWeight: "700",
    marginTop: 4,
  },

  balanceIcon: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: "#EEEEEE",
    alignItems: "center",
    justifyContent: "center",
  },

  balanceIconText: {
    color: "#000000",
    fontSize: 24,
    fontWeight: "700",
  },

  historyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 21,
    padding: 18,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    elevation: 2,
  },

  historyHeader: {
    marginBottom: 8,
  },

  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: "#F0EEE8",
    gap: 10,
  },

  historyIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: "#F5EFE1",
    alignItems: "center",
    justifyContent: "center",
  },

  historyIconText: {
    color: "#000000",
    fontSize: 19,
    fontWeight: "700",
  },

  historyInfo: {
    flex: 1,
  },

  historyAmount: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "800",
  },

  historyDate: {
    color: "#000000",
    fontSize: 11,
    marginTop: 4,
  },

  historyNote: {
    color: "#000000",
    fontSize: 11,
    marginTop: 5,
  },

  statusContainer: {
    backgroundColor: "#EAF2EC",
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 10,
  },

  historyStatus: {
    color: "#000000",
    fontSize: 9,
    fontWeight: "800",
  },

  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 25,
    alignItems: "center",
  },

  emptyHistory: {
    alignItems: "center",
    paddingVertical: 22,
  },

  emptyHistoryIcon: {
    width: 55,
    height: 55,
    borderRadius: 18,
    backgroundColor: "#F5EFE1",
    color: "#000000",
    textAlign: "center",
    textAlignVertical: "center",
    fontSize: 28,
    fontWeight: "700",
    overflow: "hidden",
    marginBottom: 12,
  },

  emptyTitle: {
    color: "#000000",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 7,
  },

  emptyText: {
    color: "#000000",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
  },

  emptyButton: {
    backgroundColor: "#ffffff",
    borderRadius: 12,
    paddingHorizontal: 17,
    paddingVertical: 12,
    marginTop: 16,
  },

  emptyButtonText: {
    color: "#000000",
    fontSize: 12,
    fontWeight: "700",
  },

  loadingContainer: {
    alignItems: "center",
    paddingVertical: 25,
    gap: 12,
  },
});

export default Donar;
