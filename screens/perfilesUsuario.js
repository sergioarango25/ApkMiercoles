
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

const ZONAS = [
  { nombre: "Zona segura", distancia: "" },
  { nombre: "Refugio San Miguel", distancia: "1.2 km" },
  { nombre: "Punto de alimentación", distancia: "1.5 km" },
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

  // Referencias para avanzar entre los campos
  const nombreRef = useRef(null);
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const confirmPasswordRef = useRef(null);

  // Identifica el campo seleccionado
  const [campoActivo, setCampoActivo] = useState(null);

  // Información del perfil
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [tipoParticipacion, setTipoParticipacion] =
    useState("Voluntario");

  const [disponible, setDisponible] = useState(true);

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

            setDisponible(
              datos.disponible === undefined
                ? true
                : datos.disponible
            );

          } else {
            // Crear un perfil básico si la cuenta existe
            // pero todavía no tiene documento en Firestore.

            const perfilInicial = {
              uid: firebaseUser.uid,
              nombre: firebaseUser.displayName || "Usuario",
              email: firebaseUser.email || "",
              rol: "usuario",
              tipoParticipacion: "Voluntario",
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
            setDisponible(true);
          }

        } catch (error) {
          console.log(
            "Error al cargar el perfil:",
            error
          );

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

    // VALIDAR CAMPOS VACÍOS
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

    // VALIDAR CORREO
    const correoValido = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!correoValido.test(correo)) {
      Alert.alert(
        "Correo inválido",
        "Escribe un correo electrónico válido."
      );
      return;
    }

    // VALIDAR CONTRASEÑA
    if (password.length < 6) {
      Alert.alert(
        "Contraseña insegura",
        "La contraseña debe tener al menos 6 caracteres."
      );
      return;
    }

    // CONFIRMAR CONTRASEÑA
    if (password !== confirmPassword) {
      Alert.alert(
        "Error",
        "Las contraseñas no coinciden."
      );
      return;
    }

    try {
      setGuardando(true);

      // 1. CREAR USUARIO EN FIREBASE AUTHENTICATION
      const credencial = await createUserWithEmailAndPassword(
        auth,
        correo,
        password
      );

      const usuarioId = credencial.user.uid;

      // 2. CREAR INFORMACIÓN DEL USUARIO
      const nuevoUsuario = {
        uid: usuarioId,
        nombre: nombreLimpio,
        email: correo,
        rol: "usuario",
        tipoParticipacion: "Voluntario",
        disponible: true,
        fechaRegistro: serverTimestamp(),
      };

      // 3. GUARDAR PERFIL EN FIRESTORE
      await setDoc(
        doc(db, "usuarios", usuarioId),
        nuevoUsuario
      );

      // 4. ACTUALIZAR INFORMACIÓN EN PANTALLA
      setUser({
        ...nuevoUsuario,
        email: correo,
      });

      setTipoParticipacion("Voluntario");
      setDisponible(true);

      // 5. REGISTRAR TOKEN DEL DISPOSITIVO
      // Esto permite identificar el dispositivo
      // para futuras notificaciones push.

      try {
        await registrarNotificaciones(usuarioId);

      } catch (errorNotificacion) {
        console.log(
          "No se pudo registrar el dispositivo:",
          errorNotificacion
        );
      }

      // 6. ENVIAR NOTIFICACIÓN LOCAL DE BIENVENIDA

      try {
        await notificarRegistroExitoso(nombreLimpio);

      } catch (errorNotificacion) {
        console.log(
          "No se pudo mostrar la notificación:",
          errorNotificacion
        );
      }

      // 7. LIMPIAR FORMULARIO
      setNombre("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");

      // 8. CONFIRMAR REGISTRO
      Alert.alert(
        "¡Bienvenido a La Esperanza!",
        "Tu cuenta fue creada correctamente. Ya puedes comenzar a participar."
      );

    } catch (error) {
      console.log(
        "Error al registrar usuario:",
        error
      );

      let mensaje =
        "No se pudo crear la cuenta. Inténtalo nuevamente.";

      if (error.code === "auth/email-already-in-use") {
        mensaje =
          "Este correo ya está registrado. Puedes iniciar sesión.";

      } else if (error.code === "auth/invalid-email") {
        mensaje =
          "El correo electrónico no es válido.";

      } else if (error.code === "auth/weak-password") {
        mensaje =
          "La contraseña es demasiado débil.";

      } else if (error.code === "auth/network-request-failed") {
        mensaje =
          "Revisa tu conexión a internet.";

      } else if (
        error.code === "permission-denied" ||
        error.code === "firestore/permission-denied"
      ) {
        mensaje =
          "No se pudo guardar tu perfil. Revisa las reglas de seguridad de Firestore.";
      }

      Alert.alert(
        "No se pudo registrar",
        mensaje
      );

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

      // 1. INICIAR SESIÓN
      const credencial = await signInWithEmailAndPassword(
        auth,
        correo,
        password
      );

      const usuarioId = credencial.user.uid;

      // 2. REGISTRAR TOKEN DEL DISPOSITIVO

      try {
        await registrarNotificaciones(usuarioId);

      } catch (errorNotificacion) {
        console.log(
          "No se pudo registrar el dispositivo:",
          errorNotificacion
        );
      }

      // 3. MOSTRAR NOTIFICACIÓN DE INICIO DE SESIÓN

      try {
        await notificarInicioSesion(correo);

      } catch (errorNotificacion) {
        console.log(
          "No se pudo mostrar la notificación de inicio:",
          errorNotificacion
        );
      }

      // 4. LIMPIAR CAMPOS
      setPassword("");
      setConfirmPassword("");

    } catch (error) {
      console.log(
        "Error al iniciar sesión:",
        error
      );

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

      Alert.alert(
        "Error de inicio de sesión",
        mensaje
      );

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

    setDisponible(
      user?.disponible === undefined
        ? true
        : user.disponible
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

      await updateDoc(referencia, {
        tipoParticipacion,
        disponible,
      });

      setUser((anterior) => ({
        ...anterior,
        tipoParticipacion,
        disponible,
      }));

      setMostrarFormulario(false);

      Alert.alert(
        "¡Guardado!",
        "Tu perfil se actualizó correctamente."
      );

    } catch (error) {
      console.log(
        "Error al guardar el perfil:",
        error
      );

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
          </View>

          <View style={styles.authCard}>
            <Text style={styles.tituloCardAuth}>
              {modoRegistro
                ? "Crear cuenta"
                : "Bienvenido de nuevo"}
            </Text>

            {/* CAMPO NOMBRE */}
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

            {/* CAMPO CORREO */}
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

            {/* CAMPO CONTRASEÑA */}
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

            {/* CAMBIAR ENTRE REGISTRO E INICIO */}
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
      <View style={styles.encabezadoPerfil}>
        <Text style={styles.tituloPerfil}>
          Mi perfil
        </Text>
      </View>

      {/* INFORMACIÓN DEL USUARIO */}
      <View style={styles.tarjetaUsuario}>
        <View style={styles.avatar}>
          <Ionicons
            name="person"
            size={35}
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
        </View>
      </View>

      {/* PARTICIPACIÓN */}
      <View style={styles.encabezadoSeccion}>
        <Text style={styles.tituloSeccion}>
          Mi participación
        </Text>

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

      <View style={styles.tarjetaInfo}>
        <View style={styles.filaInfo}>
          <View style={styles.iconoInfo}>
            <Ionicons
              name="people-outline"
              size={23}
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

        <View style={styles.separador} />

        <View style={styles.filaInfo}>
          <View style={styles.iconoInfo}>
            <Ionicons
              name="calendar-outline"
              size={23}
              color="#12343F"
            />
          </View>

          <View style={styles.contenidoInfo}>
            <Text style={styles.etiquetaInfo}>
              Disponibilidad
            </Text>

            <Text style={styles.valorInfo}>
              {user.disponible === false
                ? "No disponible"
                : "Disponible para ayudar"}
            </Text>
          </View>

          <View
            style={[
              styles.puntoEstado,
              {
                backgroundColor:
                  user.disponible === false
                    ? "#A84A4A"
                    : "#3F8A68",
              },
            ]}
          />
        </View>
      </View>

      {/* FORMULARIO PARA EDITAR EL PERFIL */}
      {mostrarFormulario && (
        <View style={styles.tarjetaFormulario}>
          <Text style={styles.tituloFormulario}>
            Editar participación
          </Text>

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
                <Text
                  style={[
                    styles.textoOpcionRol,
                    seleccionado &&
                      styles.textoOpcionSeleccionada,
                  ]}
                >
                  {rol}
                </Text>

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

          <Text style={styles.labelRol}>
            ¿Estás disponible?
          </Text>

          <View style={styles.filaDisponibilidad}>
            <TouchableOpacity
              style={[
                styles.botonDisponibilidad,
                disponible && styles.disponibilidadActiva,
              ]}
              onPress={() => setDisponible(true)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="checkmark-circle-outline"
                size={19}
                color={
                  disponible ? "#FFFFFF" : "#12343F"
                }
              />

              <Text
                style={[
                  styles.textoDisponibilidad,
                  disponible &&
                    styles.textoDisponibilidadActivo,
                ]}
              >
                Sí, disponible
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.botonDisponibilidad,
                !disponible && styles.disponibilidadActiva,
              ]}
              onPress={() => setDisponible(false)}
              activeOpacity={0.8}
            >
              <Ionicons
                name="close-circle-outline"
                size={19}
                color={
                  !disponible ? "#FFFFFF" : "#12343F"
                }
              />

              <Text
                style={[
                  styles.textoDisponibilidad,
                  !disponible &&
                    styles.textoDisponibilidadActivo,
                ]}
              >
                No disponible
              </Text>
            </TouchableOpacity>
          </View>

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
                  Guardar
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ZONAS DE APOYO */}
      <View style={styles.encabezadoSeccion}>
        <Text style={styles.tituloSeccion}>
          Zonas de apoyo
        </Text>
      </View>

      <Text style={styles.descripcionZonas}>
        Algunos puntos de referencia de nuestra comunidad.
      </Text>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.listaZonas}
      >
        {ZONAS.map((zona, index) => (
          <View
            style={styles.tarjetaZona}
            key={zona.nombre}
          >
            <View style={styles.iconoZona}>
              <Ionicons
                name={
                  index === 0
                    ? "shield-checkmark-outline"
                    : index === 1
                    ? "home-outline"
                    : "restaurant-outline"
                }
                size={25}
                color="#12343F"
              />
            </View>

            <Text style={styles.nombreZona}>
              {zona.nombre}
            </Text>

            {zona.distancia !== "" && (
              <Text style={styles.distanciaZona}>
                {zona.distancia}
              </Text>
            )}
          </View>
        ))}
      </ScrollView>

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

  // Registro e inicio de sesión
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

  // Perfil
  perfilScroll: {
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 30,
  },

  encabezadoPerfil: {
    marginBottom: 22,
  },

  tituloPerfil: {
    fontSize: 30,
    fontWeight: "700",
    color: "#12343F",
    letterSpacing: 0.3,
    fontFamily: SERIF,
  },

  tarjetaUsuario: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 25,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 3,
    borderTopWidth: 3,
    borderTopColor: "#A8803A",
  },

  avatar: {
    width: 65,
    height: 65,
    borderRadius: 33,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
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
    fontSize: 13,
    marginTop: 5,
  },

  encabezadoSeccion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 13,
  },

  tituloSeccion: {
    color: "#12343F",
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: 0.2,
    fontFamily: SERIF,
  },

  botonEditar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#EAEFEE",
    paddingHorizontal: 12,
    paddingVertical: 9,
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
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 26,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 12,
    elevation: 2,
  },

  filaInfo: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 16,
  },

  iconoInfo: {
    width: 45,
    height: 45,
    borderRadius: 14,
    backgroundColor: "#EDF1F0",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 13,
  },

  contenidoInfo: {
    flex: 1,
  },

  etiquetaInfo: {
    color: "#5E6F74",
    fontSize: 12,
  },

  valorInfo: {
    color: "#12343F",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 5,
  },

  separador: {
    height: 1,
    backgroundColor: "#EEEAE0",
  },

  puntoEstado: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginLeft: 8,
  },

  // Formulario de edición
  tarjetaFormulario: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    marginBottom: 26,
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 3,
  },

  tituloFormulario: {
    fontSize: 20,
    color: "#12343F",
    fontWeight: "700",
    fontFamily: SERIF,
  },

  labelRol: {
    color: "#12343F",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 10,
    marginTop: 5,
  },

  opcionRol: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    borderRadius: 13,
    paddingHorizontal: 12,
    marginBottom: 8,
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

  textoOpcionRol: {
    fontSize: 13,
    color: "#5E6F74",
  },

  textoOpcionSeleccionada: {
    color: "#12343F",
    fontWeight: "700",
  },

  filaDisponibilidad: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 18,
  },

  botonDisponibilidad: {
    flex: 1,
    minHeight: 48,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "#E0DACB",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 5,
    gap: 5,
  },

  disponibilidadActiva: {
    backgroundColor: "#12343F",
    borderColor: "#12343F",
  },

  textoDisponibilidad: {
    color: "#12343F",
    fontSize: 11,
    fontWeight: "700",
  },

  textoDisponibilidadActivo: {
    color: "#FFFFFF",
  },

  filaBotonesFormulario: {
    flexDirection: "row",
    gap: 10,
    marginTop: 5,
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
    flex: 1,
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
  },

  // Zonas
  descripcionZonas: {
    color: "#5E6F74",
    fontSize: 13,
    marginTop: -5,
    marginBottom: 14,
    lineHeight: 19,
  },

  listaZonas: {
    paddingBottom: 8,
    gap: 12,
  },

  tarjetaZona: {
    width: 165,
    minHeight: 145,
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    padding: 15,
    borderWidth: 1,
    borderColor: "#E6E1D6",
    shadowColor: "#0D2832",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 12,
    elevation: 2,
  },

  iconoZona: {
    width: 45,
    height: 45,
    borderRadius: 14,
    backgroundColor: "#EAEFEE",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },

  nombreZona: {
    color: "#12343F",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
  },

  distanciaZona: {
    color: "#5E6F74",
    fontSize: 12,
    marginTop: 6,
  },

  botonCerrarSesion: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#EBD3D3",
    minHeight: 50,
    borderRadius: 14,
    marginTop: 28,
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
    marginTop: 20,
    letterSpacing: 0.3,
  },
});
