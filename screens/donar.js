
import { useEffect, useState } from 'react';

import LogoAra from '../assets/img/Logo-ara.svg';
import LogoD1 from '../assets/img/Logo-d1.svg';
import LogoExito from '../assets/img/Logo-exito.svg';

import * as Notifications from 'expo-notifications';

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
} from 'react-native';

import {
  addDoc,
  collection,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  where,
} from 'firebase/firestore';

import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebaseConfig';

// Configuración de notificaciones
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
  const [donationType, setDonationType] = useState('monetary');
  const [selectedAmount, setSelectedAmount] = useState('50000');
  const [customAmount, setCustomAmount] = useState('');
  const [donorName, setDonorName] = useState('');
  const [note, setNote] = useState('');

  const [user, setUser] = useState(null);
  const [donations, setDonations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Montos disponibles
  const amounts = [
    { value: '20000', label: '$20.000' },
    { value: '50000', label: '$50.000' },
    { value: '100000', label: '$100.000' },
    { value: '200000', label: '$200.000' },
  ];

  // Detectar el usuario autenticado
  useEffect(() => {
    const unsubscribeAuth = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);

      if (currentUser && !currentUser.displayName) {
        setDonorName('');
      } else if (currentUser) {
        setDonorName(currentUser.displayName || '');
      }
    });

    return unsubscribeAuth;
  }, []);

  // Cargar únicamente las donaciones del usuario
  useEffect(() => {
    if (!user) {
      setDonations([]);
      setLoading(false);
      return undefined;
    }

    setLoading(true);

    const donationsQuery = query(
      collection(db, 'donaciones'),
      where('usuarioId', '==', user.uid),
      orderBy('fecha', 'desc')
    );

    const unsubscribe = onSnapshot(
      donationsQuery,
      (snapshot) => {
        const donationsData = snapshot.docs.map((document) => ({
          id: document.id,
          ...document.data(),
        }));

        setDonations(donationsData);
        setLoading(false);
      },
      (error) => {
        console.error('Error al cargar donaciones:', error);
        setLoading(false);

        Alert.alert(
          'No se pudo cargar el historial',
          'Revisa tu conexión y los permisos de Firestore.'
        );
      }
    );

    return unsubscribe;
  }, [user]);

  // Notificación local para el usuario que registra la donación
  const notificarDonacion = async (monto) => {
    try {
      // Consultar permisos actuales
      let permisos = await Notifications.getPermissionsAsync();

      // Solicitar permisos si todavía no están concedidos
      if (!permisos.granted) {
        permisos = await Notifications.requestPermissionsAsync();
      }

      // Si no concede permisos, no interrumpimos el registro
      if (!permisos.granted) {
        console.log('El usuario no autorizó las notificaciones.');
        return;
      }

      // Configurar canal para Android
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync(
          'donaciones',
          {
            name: 'Donaciones',
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 250, 250, 250],
            sound: 'default',
          }
        );
      }

      // Crear notificación local
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Donación registrada',
          body: `Tu donación de $${monto.toLocaleString('es-CO')} COP se guardó correctamente.`,
          sound: 'default',
          data: {
            pantalla: 'Donar',
            monto: monto,
          },
        },
        trigger: null,
      });

      console.log('Notificación de donación enviada.');

    } catch (error) {
      console.log(
        'Error al mostrar notificación de donación:',
        error
      );
    }
  };

  // Obtener el monto seleccionado
  const getCurrentDonationValue = () => {
    const rawValue =
      selectedAmount === 'custom'
        ? customAmount
        : selectedAmount;

    const normalizedValue = String(rawValue).replace(/[.\s,$]/g, '');

    if (!/^\d+$/.test(normalizedValue)) {
      return 0;
    }

    return Number(normalizedValue);
  };

  // Seleccionar uno de los montos
  const handleSelectAmount = (value) => {
    setSelectedAmount(value);
    setCustomAmount('');
  };

  // Aceptar únicamente números en el monto personalizado
  const handleCustomAmountChange = (text) => {
    const digitsOnly = text.replace(/\D/g, '');

    setCustomAmount(digitsOnly);
    setSelectedAmount('custom');
  };

  // Validar y guardar la donación
  const handleSaveDonation = async () => {
    if (!user) {
      Alert.alert(
        'Inicia sesión',
        'Debes iniciar sesión para guardar tu donación.'
      );
      return;
    }

    const amount = getCurrentDonationValue();
    const cleanName = donorName.trim();
    const cleanNote = note.trim();

    if (!cleanName) {
      Alert.alert(
        'Falta tu nombre',
        'Escribe el nombre del donante.'
      );
      return;
    }

    if (!Number.isSafeInteger(amount) || amount < 1000) {
      Alert.alert(
        'Monto inválido',
        'Ingresa un monto de mínimo $1.000 COP, sin puntos ni comas.'
      );
      return;
    }

    if (cleanNote.length > 250) {
      Alert.alert(
        'Mensaje muy largo',
        'El mensaje debe tener máximo 250 caracteres.'
      );
      return;
    }

    // Confirmar antes de guardar
    Alert.alert(
      'Confirmar donación',
      `Vas a registrar una donación de $${amount.toLocaleString(
        'es-CO'
      )} COP. Este formulario guarda el registro, pero no realiza un pago real.`,
      [
        {
          text: 'Revisar',
          style: 'cancel',
        },
        {
          text: 'Confirmar',
          onPress: async () => {
            if (saving) return;

            try {
              setSaving(true);

              // Guardar donación en Firestore
              await addDoc(collection(db, 'donaciones'), {
                usuarioId: user.uid,
                nombreDonante: cleanName,
                correo: user.email || '',
                monto: amount,
                moneda: 'COP',
                nota: cleanNote,
                estado: 'Registrada',
                fecha: serverTimestamp(),
              });

              // Notificar únicamente a este usuario
              await notificarDonacion(amount);

              // Limpiar formulario
              setCustomAmount('');
              setSelectedAmount('50000');
              setNote('');

              Alert.alert(
                'Registro guardado',
                'Tu donación quedó guardada en Firebase y aparecerá en tu historial.'
              );

            } catch (error) {
              console.error(
                'Error al guardar donación:',
                error
              );

              Alert.alert(
                'No se pudo guardar',
                'Verifica tu conexión, que hayas iniciado sesión y las reglas de Firestore.'
              );
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  };

  // Formatear la fecha
  const formatDate = (timestamp) => {
    if (!timestamp?.toDate) {
      return 'Fecha pendiente';
    }

    return timestamp.toDate().toLocaleDateString('es-CO', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      {/* Resumen de donaciones */}
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>
          MIS DONACIONES
        </Text>

        <Text style={styles.heroValue}>
          {donations
            .reduce(
              (total, item) =>
                total + (Number(item.monto) || 0),
              0
            )
            .toLocaleString('es-CO', {
              style: 'currency',
              currency: 'COP',
              maximumFractionDigits: 0,
            })}
        </Text>

        <Text style={styles.heroHint}>
          Total de donaciones registradas en tu cuenta
        </Text>
      </View>

      {/* Tarjeta principal */}
      <View style={styles.donationCard}>
        {/* Selector de tipo */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              donationType === 'monetary' &&
                styles.toggleActive,
            ]}
            onPress={() => setDonationType('monetary')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.toggleText,
                donationType === 'monetary' &&
                  styles.toggleTextActive,
              ]}
            >
              Dinero
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.toggleButton,
              donationType === 'inkind' &&
                styles.toggleActive,
            ]}
            onPress={() => setDonationType('inkind')}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.toggleText,
                donationType === 'inkind' &&
                  styles.toggleTextActive,
              ]}
            >
              Insumos
            </Text>
          </TouchableOpacity>
        </View>

        {donationType === 'monetary' ? (
          <>
            <Text style={styles.sectionTitle}>
              Registrar donación
            </Text>

            <Text style={styles.helperText}>
              Elige un monto o escribe otro valor en pesos colombianos.
            </Text>

            {/* Montos predefinidos */}
            <View style={styles.gridAmounts}>
              {amounts.map((item) => {
                const selected =
                  selectedAmount === item.value;

                return (
                  <TouchableOpacity
                    key={item.value}
                    style={[
                      styles.amountCard,
                      selected &&
                        styles.amountCardSelected,
                    ]}
                    onPress={() =>
                      handleSelectAmount(item.value)
                    }
                    activeOpacity={0.8}
                  >
                    <Text
                      style={[
                        styles.amountText,
                        selected &&
                          styles.amountTextSelected,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Monto personalizado */}
            <Text style={styles.label}>
              Otro monto (COP)
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Ej. 30000"
              placeholderTextColor="#98A3A6"
              value={customAmount}
              onChangeText={handleCustomAmountChange}
              onFocus={() => setSelectedAmount('custom')}
              keyboardType="number-pad"
              maxLength={12}
              returnKeyType="done"
            />

            {/* Nombre del donante */}
            <Text style={styles.label}>
              Nombre del donante *
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Escribe tu nombre"
              placeholderTextColor="#98A3A6"
              value={donorName}
              onChangeText={setDonorName}
              autoCapitalize="words"
              maxLength={80}
              returnKeyType="next"
            />

            {/* Mensaje opcional */}
            <Text style={styles.label}>
              Mensaje (opcional)
            </Text>

            <TextInput
              style={[
                styles.input,
                styles.noteInput,
              ]}
              placeholder="¿Quieres dejar una nota? (máx. 250 caracteres)"
              placeholderTextColor="#98A3A6"
              value={note}
              onChangeText={setNote}
              maxLength={250}
              multiline
            />

            <Text style={styles.disclaimer}>
              Este formulario registra tu intención de donar.
              No procesa pagos ni solicita datos bancarios.
            </Text>

            {/* Botón de guardar */}
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
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.submitButtonText}>
                  Guardar donación
                </Text>
              )}
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.supermercadoContainer}>
            <Text style={styles.helperText}>
              Consulta estos comercios para encontrar productos
              de primera necesidad que puedas donar.
            </Text>
          </View>
        )}
      </View>

      {/* Comercios para donaciones de insumos */}
      {donationType === 'inkind' && (
        <View style={styles.infoContainer}>
          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>
              Tiendas D1
            </Text>

            <LogoD1 width={70} height={70} />

            <TouchableOpacity
              onPress={() =>
                Linking.openURL('https://www.d1.com.co/')
              }
            >
              <Text style={styles.linkText}>
                Visitar D1
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>
              Tiendas Ara
            </Text>

            <LogoAra width={70} height={70} />

            <TouchableOpacity
              onPress={() =>
                Linking.openURL('https://www.tiendasara.com/')
              }
            >
              <Text style={styles.linkText}>
                Visitar Ara
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.infoTitle}>
              Supermercados Éxito
            </Text>

            <LogoExito width={70} height={70} />

            <TouchableOpacity
              onPress={() =>
                Linking.openURL('https://www.exito.com/')
              }
            >
              <Text style={styles.linkText}>
                Visitar Éxito
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Historial personal */}
      {donationType === 'monetary' && (
        <View style={styles.historyCard}>
          <Text style={styles.sectionTitle}>
            Mi historial
          </Text>

          {!user ? (
            <Text style={styles.emptyText}>
              Inicia sesión para guardar y consultar tus donaciones.
            </Text>
          ) : loading ? (
            <ActivityIndicator color="#12343F" />
          ) : donations.length === 0 ? (
            <Text style={styles.emptyText}>
              Todavía no tienes donaciones registradas.
            </Text>
          ) : (
            donations.map((item) => (
              <View
                key={item.id}
                style={styles.historyItem}
              >
                <View style={styles.historyInfo}>
                  <Text style={styles.historyAmount}>
                    $
                    {(Number(item.monto) || 0).toLocaleString(
                      'es-CO'
                    )}{' '}
                    COP
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

                <Text style={styles.historyStatus}>
                  {item.estado || 'Registrada'}
                </Text>
              </View>
            ))
          )}
        </View>
      )}
    </ScrollView>
  );
};

const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
});

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F6F4EF',
  },

  container: {
    padding: 20,
    paddingBottom: 40,
  },

  heroCard: {
    backgroundColor: '#0D2832',
    borderRadius: 22,
    padding: 24,
    marginBottom: 16,
    borderBottomWidth: 3,
    borderBottomColor: '#A8803A',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 6,
  },

  heroLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.6,
    color: '#D8C08A',
    marginBottom: 8,
  },

  heroValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#E6D3A3',
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  heroHint: {
    color: '#BFCDD1',
    fontSize: 12,
    marginTop: 6,
  },

  donationCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E6E1D6',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },

  toggleContainer: {
    backgroundColor: '#EFEBE2',
    borderRadius: 14,
    padding: 4,
    flexDirection: 'row',
    marginBottom: 18,
  },

  toggleButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 11,
    alignItems: 'center',
  },

  toggleActive: {
    backgroundColor: '#ffffff',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },

  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#5E6F74',
  },

  toggleTextActive: {
    color: '#12343F',
  },

  sectionTitle: {
    fontSize: 19,
    fontWeight: '700',
    color: '#12343F',
    marginBottom: 8,
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  helperText: {
    color: '#5E6F74',
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 14,
  },

  gridAmounts: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },

  amountCard: {
    width: '48%',
    borderWidth: 1,
    borderColor: '#E6E1D6',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginBottom: 10,
  },

  amountCardSelected: {
    backgroundColor: '#F6EFE0',
    borderColor: '#A8803A',
    borderWidth: 1.5,
  },

  amountText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#12343F',
  },

  amountTextSelected: {
    color: '#7A5A1E',
  },

  label: {
    fontSize: 13,
    fontWeight: '600',
    color: '#3B4A50',
    marginTop: 8,
    marginBottom: 6,
    letterSpacing: 0.3,
  },

  input: {
    borderWidth: 1,
    borderColor: '#D9D3C5',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 13,
    fontSize: 15,
    color: '#12343F',
    backgroundColor: '#ffffff',
  },

  noteInput: {
    minHeight: 72,
    textAlignVertical: 'top',
  },

  disclaimer: {
    color: '#5E6F74',
    fontSize: 11,
    lineHeight: 16,
    marginTop: 12,
    marginBottom: 14,
  },

  submitButton: {
    width: '100%',
    paddingVertical: 16,
    backgroundColor: '#12343F',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#A8803A',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  buttonDisabled: {
    opacity: 0.65,
  },

  submitButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  supermercadoContainer: {
    paddingVertical: 10,
  },

  infoContainer: {
    marginTop: 16,
    gap: 14,
  },

  infoBox: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E6E1D6',
    alignItems: 'flex-start',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },

  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#12343F',
    marginBottom: 10,
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  linkText: {
    marginTop: 10,
    fontSize: 14,
    color: '#8F6B28',
    textDecorationLine: 'none',
    fontWeight: '600',
    letterSpacing: 0.3,
  },

  historyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 22,
    padding: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#E6E1D6',
    shadowColor: '#0D2832',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },

  emptyText: {
    color: '#5E6F74',
    fontSize: 13,
    lineHeight: 19,
  },

  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E6E1D6',
    gap: 10,
  },

  historyInfo: {
    flex: 1,
  },

  historyAmount: {
    color: '#12343F',
    fontSize: 17,
    fontWeight: '700',
    fontFamily: SERIF,
  },

  historyDate: {
    color: '#5E6F74',
    fontSize: 12,
    marginTop: 4,
  },

  historyNote: {
    color: '#4A5A60',
    fontSize: 12,
    marginTop: 4,
  },

  historyStatus: {
    color: '#8F6B28',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
});

export default Donar;
