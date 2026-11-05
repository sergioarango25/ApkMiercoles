
import { useEffect, useRef, useState } from "react";

import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { Ionicons } from "@expo/vector-icons";

import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";

import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { auth, db } from "../firebaseConfig";

import {
  notificarRegistroExitoso,
  notificarInicioSesion,
  registrarNotificaciones,
} from "../services/notificaciones";

// =====================================
// CONSTANTES
// =====================================

const ROLES = [
  "Voluntario",
  "Logística",
  "Apoyo en suministros",
];

// =====================================
// COMPONENTE PRINCIPAL
// =====================================

export default function PerfilUsuario() {
  const [user, setUser] = useState(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  // Registro e inicio de sesión
  const [modoRegistro, setModoRegistro] = useState(true);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [mostrarPassword, setMostrarPassword] = useState(false);
  const [mostrarConfirmPassword, setMostrarConfirmPassword] =
    useState(false);

  // Referencias de los campos
  const nombreRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);

  const [campoActivo, setCampoActivo] = useState(null);

  // Información del perfil
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [tipoParticipacion, setTipoParticipacion] =
    useState("Voluntario");

  // =====================================
  // CARGAR USUARIO AUTENTICADO
  // =====================================

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      auth,
      async (firebaseUser) => {
        try {
          if (!firebaseUser) {
            setUser(null);
            setCargando(false);
            return;
          }

          const referencia = doc(
            db,
            "usuarios",
            firebaseUser.uid
          );

          const resultado = await getDoc(referencia);

          if (resultado.exists()) {
            const datos = resultado.data();

            setUser({
              ...datos,
              uid: firebaseUser.uid,
              email: datos.email || firebaseUser.email,
              nombre:
                datos.nombre ||
                firebaseUser.displayName ||
                "Usuario",
            });

            setTipoParticipacion(
              datos.tipoParticipacion || "Voluntario"
            );

          } else {
            // Crear un perfil básico si todavía no existe.

            const perfilInicial = {
              uid: firebaseUser.uid,
              nombre: firebaseUser.displayName || "Usuario",
              email: firebaseUser.email || "",
              rol: "usuario",
              tipoParticipacion: "Voluntario",

              // Este campo se conserva para el funcionamiento
              // interno de la asignación de ayudas en Home.js.
              disponible: true,

              fechaRegistro: serverTimestamp(),
            };

            await setDoc(referencia, perfilInicial, {
              merge: true,
            });

            setUser({
              ...perfilInicial,
              email: firebaseUser.email || "",
            });

            setTipoParticipacion("Voluntario");
          }

        } catch (error) {
          console.log("Error al cargar el perfil:", error);

          Alert.alert(
            "Error",
            "No se pudo cargar tu perfil. Revisa tu conexión y los permisos de Firebase."
          );

          setUser(null);

        } finally {
          setCargando(false);
        }
      }
    );

    return unsubscribe;
  }, []);

  // =====================================
  // REGISTRAR USUARIO
  // =====================================

  const registrarUsuario = async () => {
    const nombreLimpio = nombre.trim();
    const correo = email.trim().toLowerCase();

    if (
      !nombreLimpio ||
      !correo ||
      !password ||
      !confirmPassword
    ) {
      Alert.alert(
        "Campos incompletos",
        "Completa todos los campos."
      );
      return;
    }

    const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!correoValido.test(correo)) {
      Alert.alert(
        "Correo inválido",
        "Escribe un correo electrónico válido."
      );
      return;
    }

    if (password.length < 6) {
      Alert.alert(
        "Contraseña insegura",
        "La contraseña debe tener al menos 6 caracteres."
      );
      return;
    }

    if (password !== confirmPassword) {
      Alert.alert(
        "Error",
        "Las contraseñas no coinciden."
      );
      return;
    }

    try {
      setGuardando(true);

      // Crear cuenta en Firebase Authentication.
      const credencial = await createUserWithEmailAndPassword(
        auth,
        correo,
        password
      );

      const usuarioId = credencial.user.uid;

      // Crear información del usuario.
      const nuevoUsuario = {
        uid: usuarioId,
        nombre: nombreLimpio,
        email: correo,
        rol: "usuario",
        tipoParticipacion: "Voluntario",

        // Se conserva para la lógica interna de Home.js.
        disponible: true,

        fechaRegistro: serverTimestamp(),
      };

      // Guardar perfil en Firestore.
      await setDoc(
        doc(db, "usuarios", usuarioId),
        nuevoUsuario
      );

      setUser({
        ...nuevoUsuario,
        email: correo,
      });

      setTipoParticipacion("Voluntario");

      // Registrar token del dispositivo.
      try {
        await registrarNotificaciones(usuarioId);
      } catch (errorNotificacion) {
        console.log(
          "No se pudo registrar el dispositivo:",
          errorNotificacion
        );
      }

      // Notificación local de bienvenida.
      try {
        await notificarRegistroExitoso(nombreLimpio);
      } catch (errorNotificacion) {
        console.log(
          "No se pudo mostrar la notificación:",
          errorNotificacion
        );
      }

      // Limpiar formulario.
      setNombre("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");

      Alert.alert(
        "¡Bienvenido a La Esperanza!",
        "Tu cuenta fue creada correctamente. Ya puedes comenzar a participar."
      );

    } catch (error) {
      console.log("Error al registrar usuario:", error);

      let mensaje =
        "No se pudo crear la cuenta. Inténtalo nuevamente.";

      if (error.code === "auth/email-already-in-use") {
        mensaje =
          "Este correo ya está registrado. Puedes iniciar sesión.";

      } else if (error.code === "auth/invalid-email") {
        mensaje = "El correo electrónico no es válido.";

      } else if (error.code === "auth/weak-password") {
        mensaje = "La contraseña es demasiado débil.";

      } else if (error.code === "auth/network-request-failed") {
        mensaje = "Revisa tu conexión a internet.";

      } else if (
        error.code === "permission-denied" ||
        error.code === "firestore/permission-denied"
      ) {
        mensaje =
          "No se pudo guardar tu perfil. Revisa las reglas de seguridad de Firestore.";
      }

      Alert.alert("No se pudo registrar", mensaje);

    } finally {
      setGuardando(false);
    }
  };

  // =====================================
  // INICIAR SESIÓN
  // =====================================

  const iniciarSesion = async () => {
    const correo = email.trim().toLowerCase();

    if (!correo || !password) {
      Alert.alert(
        "Campos incompletos",
        "Escribe tu correo y contraseña."
      );
      return;
    }

    try {
      setGuardando(true);

      const credencial = await signInWithEmailAndPassword(
        auth,
        correo,
        password
      );

      const usuarioId = credencial.user.uid;

      // Registrar token del dispositivo.
      try {
        await registrarNotificaciones(usuarioId);
      } catch (errorNotificacion) {
        console.log(
          "No se pudo registrar el dispositivo:",
          errorNotificacion
        );
      }

      // Notificación local de inicio de sesión.
      try {
        await notificarInicioSesion(correo);
      } catch (errorNotificacion) {
        console.log(
          "No se pudo mostrar la notificación de inicio:",
          errorNotificacion
        );
      }

      setPassword("");
      setConfirmPassword("");

    } catch (error) {
      console.log("Error al iniciar sesión:", error);

      let mensaje = "No se pudo iniciar sesión.";

      if (
        error.code === "auth/invalid-credential" ||
        error.code === "auth/wrong-password" ||
        error.code === "auth/user-not-found"
      ) {
        mensaje =
          "El correo o la contraseña son incorrectos.";

      } else if (error.code === "auth/invalid-email") {
        mensaje = "Escribe un correo válido.";

      } else if (error.code === "auth/network-request-failed") {
        mensaje = "Revisa tu conexión a internet.";
      }

      Alert.alert("Error de inicio de sesión", mensaje);

    } finally {
      setGuardando(false);
    }
  };

  // =====================================
  // ABRIR FORMULARIO DEL PERFIL
  // =====================================

  const abrirFormulario = () => {
    setTipoParticipacion(
      user?.tipoParticipacion || "Voluntario"
    );

    setMostrarFormulario(true);
  };

  // =====================================
  // GUARDAR INFORMACIÓN DEL PERFIL
  // =====================================

  const guardarInformacion = async () => {
    if (!auth.currentUser) {
      Alert.alert(
        "Sesión cerrada",
        "Inicia sesión para editar tu perfil."
      );
      return;
    }

    try {
      setGuardando(true);

      const referencia = doc(
        db,
        "usuarios",
        auth.currentUser.uid
      );

      // Solo se actualiza el tipo de participación.
      // No se modifica el campo disponible.
      await updateDoc(referencia, {
        tipoParticipacion,
      });

      setUser((anterior) => ({
        ...anterior,
        tipoParticipacion,
      }));

      setMostrarFormulario(false);

      Alert.alert(
        "¡Guardado!",
        "Tu perfil se actualizó correctamente."
      );

    } catch (error) {
      console.log("Error al guardar el perfil:", error);

      Alert.alert(
        "Error",
        "No se pudo guardar la información. Verifica los permisos de Firestore."
      );

    } finally {
      setGuardando(false);
    }
  };

  // =====================================
  // CERRAR SESIÓN
  // =====================================

  const cerrarSesion = () => {
    Alert.alert(
      "Cerrar sesión",
      "¿Quieres salir de tu cuenta?",
      [
        {
          text: "Cancelar",
          style: "cancel",
        },
        {
          text: "Cerrar sesión",
          style: "destructive",

          onPress: async () => {
            try {
              await signOut(auth);

              setMostrarFormulario(false);
              setPassword("");
              setConfirmPassword("");

            } catch (error) {
              console.log(
                "Error al cerrar sesión:",
                error
              );

              Alert.alert(
                "Error",
                "No se pudo cerrar la sesión."
              );
            }
          },
        },
      ]
    );
  };

  // =====================================
  // PANTALLA DE CARGA
  // =====================================

  if (cargando) {
    return (
      <View style={styles.cargandoContainer}>
        <ActivityIndicator
          size="large"
          color="#12343F"
        />

        <Text style={styles.textoCargando}>
          Cargando perfil...
        </Text>
      </View>
    );
  }

  // =====================================
  // REGISTRO E INICIO DE SESIÓN
  // =====================================

  if (!user) {
    return (
      <KeyboardAvoidingView
        style={styles.contenedorPrincipal}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.authScroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.authHeader}>
            <View style={styles.logoCirculo}>
              <Ionicons
                name="people"
                size={38}
                color="#FFFFFF"
              />
            </View>

            <Text style={styles.tituloAuth}>
              La Esperanza
            </Text>

            <Text style={styles.subtituloAuth}>
              Unidos podemos ayudar a quienes más lo necesitan.
            </Text>
          </View>

          <View style={styles.authCard}>
            <Text style={styles.tituloCardAuth}>
              {modoRegistro
                ? "Crear cuenta"
                : "Bienvenido de nuevo"}
            </Text>

            <Text style={styles.descripcionAuth}>
              {modoRegistro
                ? "Regístrate para formar parte de nuestra comunidad."
                : "Ingresa tus datos para continuar."}
            </Text>

            {/* NOMBRE */}
            {modoRegistro && (
              <>
                <Text style={styles.labelInput}>
                  Nombre completo
                </Text>

                <View
                  style={[
                    styles.inputContenedor,
                    campoActivo === "nombre" &&
                      styles.inputContenedorActivo,
                  ]}
                >
                  <Ionicons
                    name="person-outline"
                    size={20}
                    color="#5E6F74"
                  />

                  <TextInput
                    ref={nombreRef}
                    style={styles.input}
                    placeholder="Escribe tu nombre"
                    placeholderTextColor="#98A3A6"
                    value={nombre}
                    onChangeText={setNombre}
                    autoCapitalize="words"
                    returnKeyType="next"
                    blurOnSubmit={false}
                    onSubmitEditing={() =>
                      emailRef.current?.focus()
                    }
                    onFocus={() =>
                      setCampoActivo("nombre")
                    }
                    onBlur={() =>
                      setCampoActivo(null)
                    }
                    editable={!guardando}
                  />
                </View>
              </>
            )}

            {/* CORREO */}
            <Text style={styles.labelInput}>
              Correo electrónico
            </Text>

            <View
              style={[
                styles.inputContenedor,
                campoActivo === "email" &&
                  styles.inputContenedorActivo,
              ]}
            >
              <Ionicons
                name="mail-outline"
                size={20}
                color="#5E6F74"
              />

              <TextInput
                ref={emailRef}
                style={styles.input}
                placeholder="ejemplo@correo.com"
                placeholderTextColor="#98A3A6"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="next"
                blurOnSubmit={false}
                onSubmitEditing={() =>
                  passwordRef.current?.focus()
                }
                onFocus={() =>
                  setCampoActivo("email")
                }
                onBlur={() =>
                  setCampoActivo(null)
                }
                editable={!guardando}
              />
            </View>

            {/* CONTRASEÑA */}
            <Text style={styles.labelInput}>
              Contraseña
            </Text>

            <View
              style={[
                styles.inputContenedor,
                campoActivo === "password" &&
                  styles.inputContenedorActivo,
              ]}
            >
              <Ionicons
                name="lock-closed-outline"
                size={20}
                color="#5E6F74"
              />

              <TextInput
                ref={passwordRef}
                style={styles.input}
                placeholder="Mínimo 6 caracteres"
                placeholderTextColor="#98A3A6"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!mostrarPassword}
                autoCapitalize="none"
                returnKeyType={
                  modoRegistro ? "next" : "done"
                }
                blurOnSubmit={!modoRegistro}
                onSubmitEditing={() => {
                  if (modoRegistro) {
                    confirmPasswordRef.current?.focus();
                  } else {
                    iniciarSesion();
                  }
                }}
                onFocus={() =>
                  setCampoActivo("password")
                }
                onBlur={() =>
                  setCampoActivo(null)
                }
                editable={!guardando}
              />

              <TouchableOpacity
                disabled={guardando}
                onPress={() =>
                  setMostrarPassword(!mostrarPassword)
                }
              >
                <Ionicons
                  name={
                    mostrarPassword
                      ? "eye-off-outline"
                      : "eye-outline"
                  }
                  size={21}
                  color="#5E6F74"
                />
              </TouchableOpacity>
            </View>

            {/* CONFIRMAR CONTRASEÑA */}
            {modoRegistro && (
              <>
                <Text style={styles.labelInput}>
                  Confirmar contraseña
                </Text>

                <View
                  style={[
                    styles.inputContenedor,
                    campoActivo === "confirmPassword" &&
                      styles.inputContenedorActivo,
                  ]}
                >
                  <Ionicons
                    name="shield-checkmark-outline"
                    size={20}
                    color="#5E6F74"
                  />

                  <TextInput
                    ref={confirmPasswordRef}
                    style={styles.input}
                    placeholder="Repite tu contraseña"
                    placeholderTextColor="#98A3A6"
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                    secureTextEntry={!mostrarConfirmPassword}
                    autoCapitalize="none"
                    returnKeyType="done"
                    onSubmitEditing={registrarUsuario}
                    onFocus={() =>
                      setCampoActivo("confirmPassword")
                    }
                    onBlur={() =>
                      setCampoActivo(null)
                    }
                    editable={!guardando}
                  />

                  <TouchableOpacity
                    disabled={guardando}
                    onPress={() =>
                      setMostrarConfirmPassword(
                        !mostrarConfirmPassword
                      )
                    }
                  >
                    <Ionicons
                      name={
                        mostrarConfirmPassword
                          ? "eye-off-outline"
                          : "eye-outline"
                      }
                      size={21}
                      color="#5E6F74"
                    />
                  </TouchableOpacity>
                </View>
              </>
            )}

            {/* BOTÓN PRINCIPAL */}
            <TouchableOpacity
              style={[
                styles.botonPrincipal,
                guardando && styles.botonDeshabilitado,
              ]}
              onPress={
                modoRegistro
                  ? registrarUsuario
                  : iniciarSesion
              }
              disabled={guardando}
              activeOpacity={0.8}
            >
              {guardando ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.textoBotonPrincipal}>
                  {modoRegistro
                    ? "Crear mi cuenta"
                    : "Iniciar sesión"}
                </Text>
              )}
            </TouchableOpacity>

            {/* CAMBIAR MODO */}
            <View style={styles.cambiarModo}>
              <Text style={styles.textoCambiarModo}>
                {modoRegistro
                  ? "¿Ya tienes una cuenta?"
                  : "¿Todavía no tienes una cuenta?"}
              </Text>

              <TouchableOpacity
                disabled={guardando}
                onPress={() => {
                  setModoRegistro(!modoRegistro);
                  setPassword("");
                  setConfirmPassword("");
                  setCampoActivo(null);
                }}
              >
                <Text style={styles.enlaceCambiarModo}>
                  {modoRegistro
                    ? "Inicia sesión"
                    : "Regístrate"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  // =====================================
  // PERFIL DEL USUARIO AUTENTICADO
  // =====================================

  return (
    <ScrollView
      style={styles.contenedorPrincipal}
      contentContainerStyle={styles.perfilScroll}
      showsVerticalScrollIndicator={false}
    >
      {/* ENCABEZADO */}
      <View style={styles.encabezadoPerfil}>
        <View>
          <Text style={styles.tituloPerfil}>
            Mi perfil
          </Text>

          <Text style={styles.subtituloPerfil}>
            Tu información personal
          </Text>
        </View>

        <View style={styles.iconoEncabezado}>
          <Ionicons
            name="person-outline"
            size={24}
            color="#12343F"
          />
        </View>
      </View>

      {/* INFORMACIÓN DEL USUARIO */}
      <View style={styles.tarjetaUsuario}>
        <View style={styles.avatar}>
          <Ionicons
            name="person"
            size={36}
            color="#12343F"
          />
        </View>

        <View style={styles.datosUsuario}>
          <Text style={styles.nombreUsuario}>
            {user.nombre || "Usuario"}
          </Text>

          <Text style={styles.correoUsuario}>
            {user.email || "Sin correo registrado"}
          </Text>

          <View style={styles.etiquetaCuenta}>
            <View style={styles.puntoCuenta} />

            <Text style={styles.textoEtiquetaCuenta}>
              Cuenta activa
            </Text>
          </View>
        </View>
      </View>

      {/* PARTICIPACIÓN */}
      <View style={styles.encabezadoSeccion}>
        <View>
          <Text style={styles.tituloSeccion}>
            Mi participación
          </Text>

          <Text style={styles.descripcionSeccion}>
            Así formas parte de La Esperanza.
          </Text>
        </View>

        <TouchableOpacity
          style={styles.botonEditar}
          onPress={abrirFormulario}
          activeOpacity={0.8}
        >
          <Ionicons
            name="create-outline"
            size={17}
            color="#12343F"
          />

          <Text style={styles.textoBotonEditar}>
            Editar
          </Text>
        </TouchableOpacity>
      </View>

      {/* TARJETA DE PARTICIPACIÓN */}
      <View style={styles.tarjetaInfo}>
        <View style={styles.iconoInfo}>
          <Ionicons
            name="people-outline"
            size={25}
            color="#12343F"
          />
        </View>

        <View style={styles.contenidoInfo}>
          <Text style={styles.etiquetaInfo}>
            Tipo de participación
          </Text>

          <Text style={styles.valorInfo}>
            {user.tipoParticipacion || "Voluntario"}
          </Text>
        </View>
      </View>

      {/* FORMULARIO DE EDICIÓN */}
      {mostrarFormulario && (
        <View style={styles.tarjetaFormulario}>
          <View style={styles.encabezadoFormulario}>
            <View>
              <Text style={styles.tituloFormulario}>
                Editar participación
              </Text>

              <Text style={styles.descripcionFormulario}>
                Selecciona cómo deseas colaborar.
              </Text>
            </View>

            <View style={styles.iconoFormulario}>
              <Ionicons
                name="create-outline"
                size={22}
                color="#12343F"
              />
            </View>
          </View>

          <Text style={styles.labelRol}>
            Tipo de participación
          </Text>

          {ROLES.map((rol) => {
            const seleccionado =
              tipoParticipacion === rol;

            return (
              <TouchableOpacity
                key={rol}
                style={[
                  styles.opcionRol,
                  seleccionado &&
                    styles.opcionRolSeleccionada,
                ]}
                onPress={() =>
                  setTipoParticipacion(rol)
                }
                activeOpacity={0.8}
              >
                <View style={styles.contenidoOpcionRol}>
                  <Ionicons
                    name={
                      rol === "Voluntario"
                        ? "people-outline"
                        : rol === "Logística"
                        ? "clipboard-outline"
                        : "cube-outline"
                    }
                    size={21}
                    color={
                      seleccionado
                        ? "#12343F"
                        : "#68777A"
                    }
                  />

                  <Text
                    style={[
                      styles.textoOpcionRol,
                      seleccionado &&
                        styles.textoOpcionSeleccionada,
                    ]}
                  >
                    {rol}
                  </Text>
                </View>

                <Ionicons
                  name={
                    seleccionado
                      ? "radio-button-on"
                      : "radio-button-off"
                  }
                  size={21}
                  color={
                    seleccionado
                      ? "#12343F"
                      : "#98A3A6"
                  }
                />
              </TouchableOpacity>
            );
          })}

          <View style={styles.filaBotonesFormulario}>
            <TouchableOpacity
              style={styles.botonCancelar}
              onPress={() =>
                setMostrarFormulario(false)
              }
              disabled={guardando}
            >
              <Text style={styles.textoBotonCancelar}>
                Cancelar
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.botonGuardar,
                guardando && styles.botonDeshabilitado,
              ]}
              onPress={guardarInformacion}
              disabled={guardando}
            >
              {guardando ? (
                <ActivityIndicator color="#FFFFFF" />
              ) : (
                <Text style={styles.textoBotonGuardar}>
                  Guardar cambios
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* MENSAJE DE COMUNIDAD */}
      <View style={styles.tarjetaMensaje}>
        <View style={styles.iconoMensaje}>
          <Ionicons
            name="heart-outline"
            size={25}
            color="#A8803A"
          />
        </View>

        <View style={styles.contenidoMensaje}>
          <Text style={styles.tituloMensaje}>
            Gracias por ser parte
          </Text>

          <Text style={styles.textoMensaje}>
            Cada persona que decide ayudar puede marcar
            una diferencia en la vida de alguien.
          </Text>
        </View>
      </View>

      {/* CERRAR SESIÓN */}
      <TouchableOpacity
        style={styles.botonCerrarSesion}
        onPress={cerrarSesion}
        activeOpacity={0.8}
      >
        <Ionicons
          name="log-out-outline"
          size={20}
          color="#9C3F3F"
        />

        <Text style={styles.textoCerrarSesion}>
          Cerrar sesión
        </Text>
      </TouchableOpacity>

      <Text style={styles.piePerfil}>
        La Esperanza · Unidos para ayudar
      </Text>
    </ScrollView>
  );
}

// =====================================
// FUENTE
// =====================================

const SERIF = Platform.select({
  ios: "Georgia",
  android: "serif",
  default: "Georgia, serif",
});

// =====================================
// ESTILOS
// =====================================

const styles = StyleSheet.create({
  contenedorPrincipal: {
    flex: 1,
    backgroundColor: "#F6F4EF",
  },

  cargandoContainer: {
    flex: 1,
    backgroundColor: "#F6F4EF",
    alignItems: "center",
    justifyContent: "center",
  },

  textoCargando: {
    marginTop: 12,
    color: "#12343F",
    fontSize: 14,
  },

  // REGISTRO E INICIO DE SESIÓN

  authScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 30,
  },

  authHeader: {
    alignItems: "center",
    marginBottom: 25,
  },

  logoCirculo: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#12343F",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
    borderWidth: 2,
    borderColor: "#A8803A",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 14,
    elevation: 4,
  },

  tituloAuth: {
    fontSize: 30,
    fontWeight: "700",
    color: "#12343F",
    letterSpacing: 0.4,
    fontFamily: SERIF,
  },

  subtituloAuth: {
    color: "#68777A",
    fontSize: 13,
    textAlign: "center",
    marginTop: 9,
    lineHeight: 20,
    paddingHorizontal: 15,
  },

  authCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
    elevation: 5,
    borderTopWidth: 3,
    borderTopColor: "#A8803A",
  },

  tituloCardAuth: {
    textAlign: "center",
    fontSize: 23,
    fontWeight: "700",
    color: "#12343F",
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  descripcionAuth: {
    textAlign: "center",
    color: "#68777A",
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 10,
  },

  labelInput: {
    color: "#12343F",
    fontWeight: "700",
    fontSize: 13,
    marginBottom: 8,
    marginTop: 12,
    letterSpacing: 0.3,
  },

  inputContenedor: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: "#D9D3C5",
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    backgroundColor: "#FBFAF7",
  },

  inputContenedorActivo: {
    borderColor: "#12343F",
    borderWidth: 1.5,
    backgroundColor: "#FFFFFF",
  },

  input: {
    flex: 1,
    color: "#12242B",
    fontSize: 14,
    paddingVertical: 12,
    paddingHorizontal: 10,
  },

  botonPrincipal: {
    backgroundColor: "#12343F",
    minHeight: 54,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 24,
    borderBottomWidth: 2,
    borderBottomColor: "#A8803A",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 12,
    elevation: 4,
  },

  botonDeshabilitado: {
    opacity: 0.65,
  },

  textoBotonPrincipal: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },

  cambiarModo: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 20,
    gap: 5,
  },

  textoCambiarModo: {
    color: "#5E6F74",
    fontSize: 13,
  },

  enlaceCambiarModo: {
    color: "#8F6B28",
    fontSize: 13,
    fontWeight: "800",
  },

  // PERFIL

  perfilScroll: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 35,
  },

  encabezadoPerfil: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 23,
  },

  tituloPerfil: {
    fontSize: 30,
    fontWeight: "700",
    color: "#12343F",
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  subtituloPerfil: {
    color: "#68777A",
    fontSize: 13,
    marginTop: 5,
  },

  iconoEncabezado: {
    width: 47,
    height: 47,
    borderRadius: 16,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
  },

  // TARJETA DEL USUARIO

  tarjetaUsuario: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 29,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
    borderTopWidth: 3,
    borderTopColor: "#A8803A",
  },

  avatar: {
    width: 67,
    height: 67,
    borderRadius: 34,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 15,
    borderWidth: 2,
    borderColor: "#A8803A",
  },

  datosUsuario: {
    flex: 1,
  },

  nombreUsuario: {
    color: "#12343F",
    fontSize: 19,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  correoUsuario: {
    color: "#5E6F74",
    fontSize: 12,
    marginTop: 5,
  },

  etiquetaCuenta: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EDF4EF",
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
    marginTop: 10,
  },

  puntoCuenta: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#3F8A68",
    marginRight: 6,
  },

  textoEtiquetaCuenta: {
    color: "#3F7658",
    fontSize: 11,
    fontWeight: "700",
  },

  // PARTICIPACIÓN

  encabezadoSeccion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  tituloSeccion: {
    color: "#12343F",
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  descripcionSeccion: {
    color: "#68777A",
    fontSize: 12,
    marginTop: 5,
  },

  botonEditar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAEFEE",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 5,
  },

  textoBotonEditar: {
    color: "#12343F",
    fontSize: 13,
    fontWeight: "700",
  },

  tarjetaInfo: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 27,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },

  iconoInfo: {
    width: 49,
    height: 49,
    borderRadius: 15,
    backgroundColor: "#EDF1F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  contenidoInfo: {
    flex: 1,
  },

  etiquetaInfo: {
    color: "#68777A",
    fontSize: 12,
  },

  valorInfo: {
    color: "#12343F",
    fontSize: 16,
    fontWeight: "700",
    marginTop: 6,
  },

  // FORMULARIO

  tarjetaFormulario: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 27,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },

  encabezadoFormulario: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },

  tituloFormulario: {
    fontSize: 20,
    color: "#12343F",
    fontWeight: "700",
    fontFamily: SERIF,
  },

  descripcionFormulario: {
    color: "#68777A",
    fontSize: 12,
    marginTop: 5,
  },

  iconoFormulario: {
    width: 43,
    height: 43,
    borderRadius: 14,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
  },

  labelRol: {
    color: "#12343F",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 11,
  },

  opcionRol: {
    minHeight: 53,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    borderRadius: 13,
    paddingHorizontal: 13,
    marginBottom: 9,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#FFFFFF",
  },

  opcionRolSeleccionada: {
    borderColor: "#12343F",
    backgroundColor: "#EEF3F2",
    borderWidth: 1.5,
  },

  contenidoOpcionRol: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },

  textoOpcionRol: {
    fontSize: 13,
    color: "#5E6F74",
  },

  textoOpcionSeleccionada: {
    color: "#12343F",
    fontWeight: "700",
  },

  filaBotonesFormulario: {
    flexDirection: "row",
    gap: 10,
    marginTop: 14,
  },

  botonCancelar: {
    flex: 1,
    minHeight: 50,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#E0DACB",
    alignItems: "center",
    justifyContent: "center",
  },

  textoBotonCancelar: {
    color: "#5E6F74",
    fontWeight: "700",
  },

  botonGuardar: {
    flex: 1.4,
    minHeight: 50,
    borderRadius: 13,
    backgroundColor: "#12343F",
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: "#A8803A",
  },

  textoBotonGuardar: {
    color: "#FFFFFF",
    fontWeight: "700",
    fontSize: 13,
  },

  // MENSAJE DE COMUNIDAD

  tarjetaMensaje: {
    backgroundColor: "#F0EDE4",
    borderRadius: 19,
    padding: 17,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 25,
    borderWidth: 1,
    borderColor: "#E6E1D6",
  },

  iconoMensaje: {
    width: 47,
    height: 47,
    borderRadius: 15,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  contenidoMensaje: {
    flex: 1,
  },

  tituloMensaje: {
    color: "#12343F",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 5,
  },

  textoMensaje: {
    color: "#5E6F74",
    fontSize: 12,
    lineHeight: 18,
  },

  // CERRAR SESIÓN

  botonCerrarSesion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EBD3D3",
    minHeight: 52,
    borderRadius: 14,
    marginTop: 5,
    gap: 8,
  },

  textoCerrarSesion: {
    color: "#9C3F3F",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.3,
  },

  piePerfil: {
    textAlign: "center",
    color: "#8C979A",
    fontSize: 12,
    marginTop: 22,
    letterSpacing: 0.3,
  },
});
