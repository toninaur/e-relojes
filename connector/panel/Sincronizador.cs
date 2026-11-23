// Sincronizador.exe: el programa de la PC del local para el sincronizador
// Aronium ↔ tienda online. Ícono junto al reloj de Windows y una ventana con
// el estado, la bitácora, los pedidos web que esperan pago y la configuración.
// Funciona sin internet: todo lo lee y escribe en la carpeta del sincronizador.
//
// El sincronizador (src/index.mjs) corre como tarea del sistema; este programa
// corre con el usuario que inició sesión y se comunica por archivos
// (src/status.mjs):
//   status.json           cómo anda (lo escribe el sincronizador)
//   avisos.json           pedidos web que esperan "Pagado" (ídem)
//   connector.log         bitácora (ídem)
//   config.json           configuración (la edita este programa; el
//                         sincronizador la relee sola)
//   comandos\orden.json   "Sincronizar ahora" (lo escribe este programa)
//
// Se compila con el compilador de C# que trae Windows (panel\build.ps1, lo
// corre install.ps1). C# 5: sin $"", ?. ni nameof.
//
//   Sincronizador.exe            abre la ventana
//   Sincronizador.exe --oculto   solo el ícono (al iniciar Windows)

using System;
using System.Collections;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: System.Reflection.AssemblyTitle("Sincronizador Aronium - Tienda")]
[assembly: System.Reflection.AssemblyProduct("Sincronizador Aronium - Tienda")]
[assembly: System.Reflection.AssemblyVersion("1.0.0.0")]

namespace SincronizadorPanel
{
    static class Program
    {
        public const string Version = "1.0";

        [DllImport("user32.dll")]
        static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            bool created;
            var mutex = new Mutex(true, "Local\\SincronizadorAroniumPrograma", out created);
            var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\SincronizadorAroniumProgramaMostrar");
            if (!created)
            {
                // Ya está abierto (junto al reloj): que muestre su ventana.
                showEvent.Set();
                return;
            }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            bool hidden = args.Any(a => a == "--oculto" || a == "/oculto");
            var form = new MainForm(!hidden);
            var listener = new Thread(() =>
            {
                while (true)
                {
                    showEvent.WaitOne();
                    try { form.BeginInvoke(new Action(() => form.ShowWindow(null))); } catch { }
                }
            });
            listener.IsBackground = true;
            listener.Start();
            Application.Run(form);
            GC.KeepAlive(mutex);
        }
    }

    // ---- JSON -----------------------------------------------------------------

    static class Json
    {
        public static object Parse(string text)
        {
            var serializer = new JavaScriptSerializer();
            serializer.MaxJsonLength = int.MaxValue;
            return serializer.DeserializeObject(text.TrimStart('\uFEFF'));
        }

        public static Dictionary<string, object> ReadFile(string path)
        {
            try
            {
                if (!File.Exists(path)) return null;
                string text;
                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                    text = reader.ReadToEnd();
                return Parse(text) as Dictionary<string, object>;
            }
            catch { return null; }
        }

        public static Dictionary<string, object> Obj(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v)) return null;
            return v as Dictionary<string, object>;
        }

        public static Dictionary<string, object> ObjOrNew(Dictionary<string, object> d, string key)
        {
            var o = Obj(d, key);
            if (o == null) { o = new Dictionary<string, object>(); d[key] = o; }
            return o;
        }

        public static string Str(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) return null;
            if (v is bool) return (bool)v ? "true" : "false";
            return Convert.ToString(v, CultureInfo.InvariantCulture);
        }

        public static bool? Bool(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || !(v is bool)) return null;
            return (bool)v;
        }

        public static double? Num(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null || v is string || v is bool) return null;
            try { return Convert.ToDouble(v, CultureInfo.InvariantCulture); } catch { return null; }
        }

        public static DateTime? Date(Dictionary<string, object> d, string key)
        {
            var s = Str(d, key);
            if (string.IsNullOrEmpty(s)) return null;
            DateTime t;
            if (DateTime.TryParse(s, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out t)) return t.ToLocalTime();
            return null;
        }

        public static IEnumerable<Dictionary<string, object>> List(Dictionary<string, object> d, string key)
        {
            object v;
            if (d == null || !d.TryGetValue(key, out v) || v == null) yield break;
            var items = v as IEnumerable;
            if (items == null || v is string) yield break;
            foreach (var item in items)
            {
                var o = item as Dictionary<string, object>;
                if (o != null) yield return o;
            }
        }

        /// <summary>JSON con sangría de 2 espacios, sin escapar acentos (como lo escribe Node).</summary>
        public static string Write(object value)
        {
            var sb = new StringBuilder();
            WriteValue(sb, value, 0);
            sb.Append('\n');
            return sb.ToString();
        }

        static void WriteValue(StringBuilder sb, object value, int indent)
        {
            if (value == null) { sb.Append("null"); return; }
            if (value is string) { WriteString(sb, (string)value); return; }
            if (value is bool) { sb.Append((bool)value ? "true" : "false"); return; }
            if (value is int || value is long || value is short || value is decimal || value is double || value is float)
            {
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }
            var dict = value as IDictionary<string, object>;
            if (dict != null)
            {
                if (dict.Count == 0) { sb.Append("{}"); return; }
                sb.Append("{\n");
                int i = 0;
                foreach (var pair in dict)
                {
                    sb.Append(' ', indent + 2);
                    WriteString(sb, pair.Key);
                    sb.Append(": ");
                    WriteValue(sb, pair.Value, indent + 2);
                    if (++i < dict.Count) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(' ', indent).Append('}');
                return;
            }
            var list = value as IEnumerable;
            if (list != null)
            {
                var items = list.Cast<object>().ToList();
                if (items.Count == 0) { sb.Append("[]"); return; }
                sb.Append("[\n");
                for (int i = 0; i < items.Count; i++)
                {
                    sb.Append(' ', indent + 2);
                    WriteValue(sb, items[i], indent + 2);
                    if (i < items.Count - 1) sb.Append(',');
                    sb.Append('\n');
                }
                sb.Append(' ', indent).Append(']');
                return;
            }
            WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }
    }

    // ---- El sincronizador: archivos, tarea programada, Node ------------------------

    static class Agent
    {
        public const string TaskName = "Sincronizador Aronium - Tienda";

        public static readonly string Root = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory).TrimEnd('\\');
        public static readonly string ConfigPath = Path.Combine(Root, "config.json");
        public static readonly string StatusPath = Path.Combine(Root, "status.json");
        public static readonly string AlertsPath = Path.Combine(Root, "avisos.json");
        public static readonly string LogPath = Path.Combine(Root, "connector.log");
        public static readonly string OrderDir = Path.Combine(Root, "comandos");
        public static readonly string UserDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SincronizadorAronium");

        // El mismo nombre que src/lock.mjs: sha256 de la carpeta en minúsculas.
        public static string DefaultLockName()
        {
            using (var sha = SHA256.Create())
            {
                var hash = sha.ComputeHash(Encoding.UTF8.GetBytes(Root.ToLowerInvariant()));
                var hex = string.Concat(hash.Select(b => b.ToString("x2")));
                return "\\\\.\\pipe\\sincronizador-aronium-" + hex.Substring(0, 16);
            }
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        static extern bool WaitNamedPipe(string name, int timeout);

        /// <summary>¿El sincronizador está corriendo? (tiene abierto su candado, src/lock.mjs)</summary>
        public static bool IsRunning(string lockName)
        {
            if (string.IsNullOrEmpty(lockName)) lockName = DefaultLockName();
            // Dos intentos: justo cuando alguien se conecta al candado, Windows
            // puede decir por un instante que no existe.
            for (int i = 0; i < 2; i++)
            {
                if (WaitNamedPipe(lockName, 1)) return true;
                int error = Marshal.GetLastWin32Error();
                // 2 = no existe. Cualquier otra cosa (ocupado, sin permiso) = existe.
                if (error != 2) return true;
                if (i == 0) Thread.Sleep(200);
            }
            return false;
        }

        /// <summary>Corriendo según el candado o, si no contesta, porque su proceso (status.json) sigue vivo.</summary>
        public static bool IsRunning(Dictionary<string, object> status)
        {
            if (IsRunning(Json.Str(status, "lock"))) return true;
            var pid = Json.Num(status, "pid");
            if (pid == null) return false;
            try { return Process.GetProcessById((int)pid.Value).ProcessName.Equals("node", StringComparison.OrdinalIgnoreCase); }
            catch { return false; }
        }

        public static string FindNode()
        {
            var dirs = (Environment.GetEnvironmentVariable("PATH") ?? "").Split(';').ToList();
            dirs.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs"));
            dirs.Add(@"C:\Program Files\nodejs");
            foreach (var dir in dirs)
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(dir)) continue;
                    var file = Path.Combine(dir.Trim().Trim('"'), "node.exe");
                    if (File.Exists(file)) return file;
                }
                catch { }
            }
            return null;
        }

        public static int Run(string file, string arguments, out string output, int timeoutMs)
        {
            var info = new ProcessStartInfo(file, arguments);
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.RedirectStandardOutput = true;
            info.RedirectStandardError = true;
            // Node escribe UTF-8; los programas de Windows (schtasks), la página de la consola.
            var encoding = file.EndsWith("node.exe", StringComparison.OrdinalIgnoreCase) ? Encoding.UTF8 : Encoding.GetEncoding(CultureInfo.CurrentCulture.TextInfo.OEMCodePage);
            info.StandardOutputEncoding = encoding;
            info.StandardErrorEncoding = encoding;
            info.WorkingDirectory = Root;
            using (var p = Process.Start(info))
            {
                var err = p.StandardError.ReadToEndAsync();
                var outText = p.StandardOutput.ReadToEnd();
                if (!p.WaitForExit(timeoutMs)) { try { p.Kill(); } catch { } output = outText + "\n(se cortó: tardó demasiado)"; return -1; }
                output = outText + err.Result;
                return p.ExitCode;
            }
        }

        /// <summary>Lo mismo, como administrador (Windows pregunta). false si dijeron que no.</summary>
        public static bool RunElevated(string file, string arguments, out int exitCode)
        {
            exitCode = -1;
            var info = new ProcessStartInfo(file, arguments);
            info.UseShellExecute = true;
            info.Verb = "runas";
            info.WindowStyle = ProcessWindowStyle.Hidden;
            info.WorkingDirectory = Root;
            try
            {
                using (var p = Process.Start(info))
                {
                    p.WaitForExit(60000);
                    exitCode = p.HasExited ? p.ExitCode : -1;
                    return true;
                }
            }
            catch (Win32Exception) { return false; }
        }

        public static bool TaskExists()
        {
            try
            {
                string output;
                return Run("schtasks.exe", "/query /tn \"" + TaskName + "\"", out output, 15000) == 0;
            }
            catch { return false; }
        }

        /// <summary>schtasks /run o /end; si no hay permiso, lo pide como administrador.</summary>
        public static string Schtasks(string verb)
        {
            string args = "/" + verb + " /tn \"" + TaskName + "\"";
            string output;
            if (Run("schtasks.exe", args, out output, 20000) == 0) return null;
            int code;
            if (!RunElevated("schtasks.exe", args, out code)) return "Hace falta permiso de administrador y no se dio.";
            return code == 0 ? null : "La tarea programada no respondió (" + output.Trim() + ").";
        }

        static Process manual;

        /// <summary>Sin tarea programada: lo abre en esta sesión (se cierra al cerrar sesión).</summary>
        public static string StartManual()
        {
            var node = FindNode();
            if (node == null) return "No se encontró Node.js en esta PC.";
            var info = new ProcessStartInfo(node, "--disable-warning=ExperimentalWarning \"" + Path.Combine(Root, "src", "index.mjs") + "\"");
            info.UseShellExecute = false;
            info.CreateNoWindow = true;
            info.WorkingDirectory = Root;
            manual = Process.Start(info);
            return null;
        }

        public static void KillManual()
        {
            try { if (manual != null && !manual.HasExited) manual.Kill(); } catch { }
            manual = null;
        }

        public static string WriteOrder(string command)
        {
            try
            {
                Directory.CreateDirectory(OrderDir);
                File.WriteAllText(Path.Combine(OrderDir, "orden.json"), "{ \"command\": \"" + command + "\" }", new UTF8Encoding(false));
                return null;
            }
            catch (Exception e)
            {
                return "No se pudo dejar la orden en " + OrderDir + " (" + e.Message + "). Volvé a correr install.ps1 como administrador: da el permiso.";
            }
        }

        public static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
        }
    }

    // ---- config.json ------------------------------------------------------------

    static class Config
    {
        /// <summary>config.json; vacío si no existe, null si existe pero no se puede leer (JSON roto).</summary>
        public static Dictionary<string, object> Load()
        {
            if (!File.Exists(Agent.ConfigPath)) return new Dictionary<string, object>();
            return Json.ReadFile(Agent.ConfigPath);
        }

        /// <summary>Guarda config.json (antes, copia la versión anterior). null = bien; si no, el error.</summary>
        public static string Save(Dictionary<string, object> config)
        {
            var text = Json.Write(config);
            var bytes = new UTF8Encoding(false).GetBytes(text);
            try
            {
                Directory.CreateDirectory(Agent.UserDir);
                if (File.Exists(Agent.ConfigPath)) File.Copy(Agent.ConfigPath, Path.Combine(Agent.UserDir, "config-anterior.json"), true);
            }
            catch { }
            try
            {
                // En el mismo archivo (no temporal + renombrar): el usuario tiene
                // permiso sobre config.json, no sobre toda la carpeta.
                File.WriteAllBytes(Agent.ConfigPath, bytes);
                return null;
            }
            catch (UnauthorizedAccessException)
            {
                // Sin permiso (no se corrió install.ps1 nuevo): se copia como administrador.
                var tmp = Path.Combine(Path.GetTempPath(), "sincronizador-config-" + Guid.NewGuid().ToString("N") + ".json");
                File.WriteAllBytes(tmp, bytes);
                int code;
                bool asked = Agent.RunElevated("cmd.exe", "/c copy /y \"" + tmp + "\" \"" + Agent.ConfigPath + "\"", out code);
                try { File.Delete(tmp); } catch { }
                if (!asked) return "No hay permiso para escribir config.json y no se dio el de administrador.";
                return code == 0 ? null : "No se pudo escribir config.json como administrador.";
            }
            catch (Exception e)
            {
                return "No se pudo guardar config.json: " + e.Message;
            }
        }

        public static bool AlertsEnabled(Dictionary<string, object> config)
        {
            return Json.Bool(Json.Obj(config, "alerts"), "enabled") != false;
        }

        public static bool AgentDownAlerts(Dictionary<string, object> config)
        {
            return Json.Bool(Json.Obj(config, "alerts"), "agentDown") != false;
        }
    }

    // ---- Estado ---------------------------------------------------------------------

    enum Level { Ok, Warn, Error, Off }

    class Health
    {
        public Level Level;
        public string Title;
        public string Detail;
        public bool Running;
        public Dictionary<string, object> Status;
    }

    static class Fmt
    {
        static readonly CultureInfo Es = CultureInfo.GetCultureInfo("es-ES");

        public static string When(DateTime? t)
        {
            if (t == null) return "—";
            var ago = DateTime.Now - t.Value;
            string rel;
            if (ago.TotalSeconds < 0) rel = "en " + Span(-ago);
            else if (ago.TotalSeconds < 50) rel = "hace unos segundos";
            else rel = "hace " + Span(ago);
            var day = t.Value.Date == DateTime.Today ? "hoy" : t.Value.ToString("dd/MM", Es);
            return day + " " + t.Value.ToString("HH:mm", Es) + " (" + rel + ")";
        }

        public static string Span(TimeSpan s)
        {
            if (s.TotalMinutes < 1) return Math.Max(1, (int)s.TotalSeconds) + " s";
            if (s.TotalHours < 1) return (int)s.TotalMinutes + " min";
            if (s.TotalDays < 1) return (int)s.TotalHours + " h " + s.Minutes + " min";
            return (int)s.TotalDays + " días";
        }

        public static string Money(double? amount, string currency)
        {
            if (amount == null) return "";
            var text = Math.Round(amount.Value).ToString("N0", CultureInfo.GetCultureInfo("es-ES"));
            if (!string.IsNullOrEmpty(currency) && currency != "PYG") return currency + " " + text;
            return "Gs. " + text;
        }
    }

    // ---- La ventana y el ícono ------------------------------------------------------

    class MainForm : Form
    {
        readonly bool showOnStart;
        NotifyIcon tray;
        readonly Dictionary<Level, Icon> icons = new Dictionary<Level, Icon>();
        TabControl tabs;
        TabPage tabStatus, tabLog, tabOrders, tabConfig;
        System.Windows.Forms.Timer timer;

        // Estado
        Panel banner;
        Label bannerTitle, bannerDetail;
        readonly Dictionary<string, Label> facts = new Dictionary<string, Label>();
        Button btnSync, btnFull, btnPause, btnStart, btnRestart, btnCheck, btnWindow, btnPanel, btnFolder;
        ToolStripMenuItem menuSync, menuPause;

        // Bitácora
        RichTextBox logBox;
        CheckBox logOnlyErrors;
        long logStamp = -1;
        string lastLogLine = "";

        // Pedidos
        ListView ordersList;
        Label ordersLabel;
        Dictionary<string, object> alerts;
        DateTime alertsStamp;

        // Configuración
        Dictionary<string, object> config;
        DateTime configStamp;
        bool configDirty, loadingConfig;
        TextBox cfStoreUrl, cfToken, cfApiKey, cfDb, cfWarehouse, cfUser, cfCustomer, cfPayTransfer, cfPayCash, cfShipping, cfServiceType, cfBackupDir;
        NumericUpDown cfInterval, cfKeepBackups;
        CheckBox cfIntervalFromPanel, cfWebSales, cfAlerts, cfAgentDown, cfShowToken;
        Label configNote;

        // Avisos
        readonly HashSet<string> seen = new HashSet<string>();
        string seenPath;
        Health health;
        DateTime? stoppedSince, storeErrorSince;
        bool stoppedWarned, storeWarned, closeHintShown;
        string blockedWarned;
        TabPage balloonTarget;
        bool busy;

        public MainForm(bool show)
        {
            showOnStart = show;
            Text = "Sincronizador Aronium ↔ Tienda";
            Font = new Font("Segoe UI", 9.5f);
            AutoScaleMode = AutoScaleMode.Font;
            ClientSize = new Size(900, 620);
            MinimumSize = new Size(720, 480);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = SystemColors.Window;

            foreach (Level l in Enum.GetValues(typeof(Level))) icons[l] = MakeIcon(l);
            Icon = icons[Level.Off];

            seenPath = Path.Combine(Agent.UserDir, "avisos-vistos.txt");
            try { if (File.Exists(seenPath)) foreach (var line in File.ReadAllLines(seenPath, Encoding.UTF8)) seen.Add(line); } catch { }

            BuildTray();
            tabs = new TabControl { Dock = DockStyle.Fill, Padding = new Point(14, 5) };
            tabStatus = new TabPage("Estado") { BackColor = SystemColors.Window };
            tabLog = new TabPage("Bitácora") { BackColor = SystemColors.Window };
            tabOrders = new TabPage("Pedidos web") { BackColor = SystemColors.Window };
            tabConfig = new TabPage("Configuración") { BackColor = SystemColors.Window };
            tabs.TabPages.AddRange(new[] { tabStatus, tabLog, tabOrders, tabConfig });
            Controls.Add(tabs);
            BuildStatus();
            BuildLog();
            BuildOrders();
            BuildConfig();
            tabs.SelectedIndexChanged += (s, e) => { if (tabs.SelectedTab == tabLog) RefreshLog(true); };

            timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += (s, e) => Tick();
        }

        protected override void SetVisibleCore(bool value)
        {
            // Con --oculto arranca solo con el ícono.
            if (!IsHandleCreated && !showOnStart)
            {
                CreateHandle();
                value = false;
            }
            base.SetVisibleCore(value);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            LoadConfigIntoForm(true);
            Tick();
            timer.Start();
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (e.CloseReason == CloseReason.UserClosing)
            {
                // La X esconde la ventana: el ícono sigue junto al reloj.
                e.Cancel = true;
                Hide();
                if (!closeHintShown)
                {
                    tray.ShowBalloonTip(5000, "Sigue funcionando", "El programa queda junto al reloj. El sincronizador sigue igual, con o sin esta ventana.", ToolTipIcon.Info);
                    closeHintShown = true;
                    balloonTarget = null;
                }
                return;
            }
            tray.Visible = false;
            base.OnFormClosing(e);
        }

        public void ShowWindow(TabPage page)
        {
            Show();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            if (page != null) tabs.SelectedTab = page;
            Activate();
            BringToFront();
        }

        // ---- Ícono ------------------------------------------------------------------

        static Icon MakeIcon(Level level)
        {
            Color color;
            switch (level)
            {
                case Level.Ok: color = Color.FromArgb(46, 158, 68); break;
                case Level.Warn: color = Color.FromArgb(224, 161, 0); break;
                case Level.Error: color = Color.FromArgb(208, 52, 44); break;
                default: color = Color.FromArgb(128, 128, 128); break;
            }
            using (var bmp = new Bitmap(32, 32))
            {
                using (var g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    using (var b = new SolidBrush(color)) g.FillEllipse(b, 1, 1, 30, 30);
                    using (var pen = new Pen(Color.White, 3.2f))
                    {
                        g.DrawArc(pen, 8, 8, 16, 16, 200, 140);
                        g.DrawArc(pen, 8, 8, 16, 16, 20, 140);
                    }
                    using (var w = new SolidBrush(Color.White))
                    {
                        g.FillPolygon(w, new[] { new PointF(24.5f, 9f), new PointF(26.5f, 17f), new PointF(19f, 14.5f) });
                        g.FillPolygon(w, new[] { new PointF(7.5f, 23f), new PointF(5.5f, 15f), new PointF(13f, 17.5f) });
                    }
                }
                return Icon.FromHandle(bmp.GetHicon());
            }
        }

        void BuildTray()
        {
            var menu = new ContextMenuStrip();
            var open = menu.Items.Add("Abrir el sincronizador", null, (s, e) => ShowWindow(tabStatus));
            open.Font = new Font(open.Font, FontStyle.Bold);
            menuSync = (ToolStripMenuItem)menu.Items.Add("Sincronizar ahora", null, (s, e) => SyncNow(false));
            menuPause = (ToolStripMenuItem)menu.Items.Add("Pausar", null, (s, e) => TogglePause());
            menu.Items.Add("Pedidos web que esperan pago", null, (s, e) => ShowWindow(tabOrders));
            menu.Items.Add("Bitácora", null, (s, e) => ShowWindow(tabLog));
            menu.Items.Add("Abrir el panel de la tienda", null, (s, e) => OpenStorePanel());
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Cerrar este programa (el sincronizador sigue)", null, (s, e) =>
            {
                tray.Visible = false;
                Application.Exit();
            });
            tray = new NotifyIcon { Icon = icons[Level.Off], Text = "Sincronizador: cargando…", Visible = true, ContextMenuStrip = menu };
            tray.DoubleClick += (s, e) => ShowWindow(tabStatus);
            tray.MouseClick += (s, e) => { if (e.Button == MouseButtons.Left) ShowWindow(null); };
            tray.BalloonTipClicked += (s, e) => ShowWindow(balloonTarget ?? tabStatus);
        }

        void Balloon(string title, string text, ToolTipIcon icon, TabPage target)
        {
            balloonTarget = target;
            tray.ShowBalloonTip(15000, title, string.IsNullOrEmpty(text) ? " " : text, icon);
        }

        // ---- Pestaña Estado -----------------------------------------------------------

        static Button MakeButton(string text, EventHandler click)
        {
            var b = new Button { Text = text, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(8, 3, 8, 3), Margin = new Padding(0, 0, 8, 8), UseVisualStyleBackColor = true };
            b.Click += click;
            return b;
        }

        void BuildStatus()
        {
            var root = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3, Padding = new Padding(14) };
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

            banner = new Panel { Dock = DockStyle.Top, Height = 78, Padding = new Padding(16, 10, 16, 10), Margin = new Padding(0, 0, 0, 12) };
            bannerTitle = new Label { Dock = DockStyle.Top, AutoSize = false, Height = 30, Font = new Font("Segoe UI Semibold", 14f), ForeColor = Color.White };
            bannerDetail = new Label { Dock = DockStyle.Fill, AutoSize = false, ForeColor = Color.White };
            banner.Controls.Add(bannerDetail);
            banner.Controls.Add(bannerTitle);
            root.Controls.Add(banner, 0, 0);

            var buttons = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, WrapContents = true, Margin = new Padding(0, 0, 0, 8) };
            btnSync = MakeButton("Sincronizar ahora", (s, e) => SyncNow(false));
            btnFull = MakeButton("Pasada completa", (s, e) => SyncNow(true));
            btnPause = MakeButton("Pausar", (s, e) => TogglePause());
            btnStart = MakeButton("Iniciar", (s, e) => StartAgent());
            btnRestart = MakeButton("Reiniciar", (s, e) => RestartAgent());
            btnCheck = MakeButton("Revisar todo", (s, e) => RunCheck());
            btnWindow = MakeButton("Abrir en ventana (diagnóstico)", (s, e) => OpenConsole());
            btnPanel = MakeButton("Panel de la tienda", (s, e) => OpenStorePanel());
            btnFolder = MakeButton("Abrir carpeta", (s, e) => Process.Start("explorer.exe", "\"" + Agent.Root + "\""));
            var tips = new ToolTip();
            tips.SetToolTip(btnSync, "Hace una pasada ya, sin esperar el próximo turno.");
            tips.SetToolTip(btnFull, "Manda todo el catálogo de Aronium a la tienda, aunque no haya cambiado.");
            tips.SetToolTip(btnPause, "Deja de leer Aronium y de registrar pedidos web hasta reanudar. Funciona sin internet.");
            tips.SetToolTip(btnStart, "Abre el sincronizador (la tarea programada de Windows).");
            tips.SetToolTip(btnRestart, "Cierra y vuelve a abrir el sincronizador.");
            tips.SetToolTip(btnCheck, "Revisa Node, config.json, Aronium, la conexión con la tienda y el reloj. No cambia nada.");
            tips.SetToolTip(btnWindow, "Con el sincronizador detenido: lo abre en una ventana negra para ver qué pasa.");
            buttons.Controls.AddRange(new Control[] { btnSync, btnFull, btnPause, btnStart, btnRestart, btnCheck, btnWindow, btnPanel, btnFolder });
            root.Controls.Add(buttons, 0, 1);

            var grid = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, AutoScroll = false };
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 190));
            grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            string[][] rows =
            {
                new[] { "running", "Sincronizador" },
                new[] { "lastPass", "Última pasada" },
                new[] { "nextPass", "Próxima pasada" },
                new[] { "store", "Tienda online" },
                new[] { "aronium", "Aronium" },
                new[] { "webSales", "Pedidos web" },
                new[] { "interval", "Frecuencia" },
                new[] { "activity", "Última actividad" },
                new[] { "version", "Versión y carpeta" },
            };
            foreach (var r in rows)
            {
                grid.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                var name = new Label { Text = r[1], AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 6, 8, 6) };
                var value = new Label { AutoSize = true, Margin = new Padding(0, 6, 0, 6), MaximumSize = new Size(640, 0) };
                facts[r[0]] = value;
                grid.Controls.Add(name);
                grid.Controls.Add(value);
            }
            grid.Resize += (s, e) => { foreach (var l in facts.Values) l.MaximumSize = new Size(Math.Max(200, grid.ClientSize.Width - 220), 0); };
            root.Controls.Add(grid, 0, 2);
            tabStatus.Controls.Add(root);
        }

        Health Evaluate()
        {
            var h = new Health();
            var st = Json.ReadFile(Agent.StatusPath);
            h.Status = st;
            h.Running = Agent.IsRunning(st);
            var state = Json.Str(st, "state");
            double interval = Json.Num(st, "interval_minutes") ?? 1;
            var updated = Json.Date(st, "updated_at");
            var storeError = Json.Str(st, "store_error");
            var aroniumError = Json.Str(st, "aronium_error");
            var blocked = Json.Str(st, "write_blocked_reason");
            if (!h.Running)
            {
                h.Level = Level.Error;
                h.Title = "Sincronizador detenido";
                h.Detail = "No está corriendo. Windows lo vuelve a abrir solo en unos minutos; si no, tocá «Iniciar». Mirá la bitácora para ver por qué se cerró.";
            }
            else if (st == null)
            {
                h.Level = Level.Warn;
                h.Title = "Iniciando…";
                h.Detail = "El sincronizador está arrancando.";
            }
            else if (state == "paused_local")
            {
                h.Level = Level.Warn;
                h.Title = "En pausa (desde esta PC)";
                h.Detail = "No lee Aronium ni registra pedidos web. Tocá «Reanudar» para seguir.";
            }
            else if (storeError != null)
            {
                h.Level = Level.Error;
                h.Title = "Sin conexión con la tienda";
                var since = Json.Date(st, "store_error_since");
                h.Detail = (since != null ? "Desde " + Fmt.When(since) + ". " : "") + "Los cambios de stock y precios se mandan solos cuando vuelva la conexión. " + storeError;
            }
            else if (aroniumError != null)
            {
                h.Level = Level.Error;
                h.Title = "No puede leer Aronium";
                h.Detail = aroniumError;
            }
            else if (state == "paused_panel")
            {
                h.Level = Level.Warn;
                h.Title = "En pausa desde el panel de la tienda";
                h.Detail = "Se reanuda desde el panel → Aronium.";
            }
            else if (updated != null && state != "passing" && (DateTime.Now - updated.Value).TotalMinutes > Math.Max(10, 2 * interval + 2))
            {
                h.Level = Level.Warn;
                h.Title = "No responde";
                h.Detail = "Está abierto pero hace " + Fmt.Span(DateTime.Now - updated.Value) + " que no hace una pasada. Probá «Reiniciar».";
            }
            else if (blocked != null)
            {
                h.Level = Level.Warn;
                h.Title = "Funcionando, pero los pedidos web están en pausa";
                h.Detail = blocked;
            }
            else if (Json.Bool(st, "last_pass_ok") == false)
            {
                h.Level = Level.Warn;
                h.Title = "Funcionando, con errores";
                h.Detail = "La última pasada tuvo errores: mirá la bitácora.";
            }
            else
            {
                h.Level = Level.Ok;
                h.Title = state == "passing" ? "Funcionando: sincronizando…" : "Funcionando";
                h.Detail = "Última pasada " + Fmt.When(Json.Date(st, "last_pass_at")) + ". Aronium y la tienda están al día.";
            }
            return h;
        }

        void Tick()
        {
            if (busy) return;
            health = Evaluate();
            var st = health.Status;
            var color = health.Level == Level.Ok ? Color.FromArgb(46, 158, 68) : health.Level == Level.Warn ? Color.FromArgb(196, 140, 0) : health.Level == Level.Error ? Color.FromArgb(200, 50, 42) : Color.Gray;
            banner.BackColor = color;
            bannerTitle.Text = health.Title;
            bannerDetail.Text = health.Detail;
            tray.Icon = icons[health.Level];
            Icon = icons[health.Level];
            var tip = "Sincronizador: " + health.Title;
            tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;

            var started = Json.Date(st, "started_at");
            facts["running"].Text = health.Running ? "Corriendo" + (started != null ? " desde " + Fmt.When(started) : "") : "Detenido";
            var lastOk = Json.Bool(st, "last_pass_ok");
            facts["lastPass"].Text = Fmt.When(Json.Date(st, "last_pass_at")) + (lastOk == false ? " — con errores" : lastOk == true ? " — bien" : "");
            facts["nextPass"].Text = health.Running ? Fmt.When(Json.Date(st, "next_pass_at")) : "—";
            var storeError = Json.Str(st, "store_error");
            var storeOkAt = Json.Date(st, "store_ok_at");
            facts["store"].Text = storeError != null ? "Sin conexión desde " + Fmt.When(Json.Date(st, "store_error_since")) + "\n" + storeError : storeOkAt != null ? "Conectada (última respuesta " + Fmt.When(storeOkAt) + ")" : "—";
            facts["store"].ForeColor = storeError != null ? Color.DarkRed : SystemColors.ControlText;
            var aroniumError = Json.Str(st, "aronium_error");
            var products = Json.Num(st, "products");
            var aroniumOkAt = Json.Date(st, "aronium_ok_at");
            facts["aronium"].Text = aroniumError ?? (aroniumOkAt == null ? "—" : (products != null ? products.Value.ToString("N0", CultureInfo.GetCultureInfo("es-ES")) + " productos leídos " : "Leída ") + Fmt.When(aroniumOkAt));
            facts["aronium"].ForeColor = aroniumError != null ? Color.DarkRed : SystemColors.ControlText;
            var webOn = Json.Bool(Json.Obj(config, "webSales"), "enabled") != false;
            var blocked = Json.Str(st, "write_blocked_reason");
            facts["webSales"].Text = !webOn ? "Desactivados en la configuración" : Json.Str(st, "state") == "paused_local" ? "En pausa (el sincronizador está pausado desde esta PC)" : blocked != null ? "En pausa: " + blocked : Json.Bool(st, "write_enabled") == true ? "Se registran en Aronium" : "—";
            facts["webSales"].ForeColor = blocked != null ? Color.DarkRed : SystemColors.ControlText;
            var minutes = Json.Num(st, "interval_minutes");
            var fromPanel = Json.Bool(st, "interval_from_panel") != false;
            facts["interval"].Text = minutes != null ? "Cada " + minutes + " min (" + (fromPanel ? "la decide el panel de la tienda" : "fijada en esta PC") + ")" : "—";
            facts["version"].Text = "Sincronizador " + (Json.Str(st, "version") ?? "?") + " · programa " + Program.Version + " · " + Agent.Root;

            var paused = Json.Bool(config, "paused") == true;
            btnPause.Text = paused ? "Reanudar" : "Pausar";
            menuPause.Text = paused ? "Reanudar" : "Pausar";
            btnSync.Enabled = btnFull.Enabled = menuSync.Enabled = health.Running && !paused;
            btnStart.Enabled = !health.Running;
            btnRestart.Enabled = health.Running;
            btnWindow.Enabled = !health.Running;

            RefreshLog(false);
            RefreshAlerts();
            ReloadConfigIfChanged();
            WatchHealth();
        }

        /// <summary>Avisos de que se detuvo o perdió la conexión (una vez por vez).</summary>
        void WatchHealth()
        {
            if (!Config.AgentDownAlerts(config)) return;
            if (!health.Running)
            {
                if (stoppedSince == null) stoppedSince = DateTime.Now;
                // Un reinicio tarda segundos: se avisa si sigue detenido más de un minuto.
                if (!stoppedWarned && (DateTime.Now - stoppedSince.Value).TotalSeconds > 60)
                {
                    Balloon("El sincronizador está detenido", "Windows lo vuelve a abrir solo en unos minutos. Hacé clic para abrir el programa e iniciarlo.", ToolTipIcon.Warning, tabStatus);
                    stoppedWarned = true;
                }
            }
            else { stoppedSince = null; stoppedWarned = false; }

            var storeError = health.Running ? Json.Str(health.Status, "store_error") : null;
            if (storeError != null)
            {
                if (storeErrorSince == null) storeErrorSince = DateTime.Now;
                if (!storeWarned && (DateTime.Now - storeErrorSince.Value).TotalMinutes >= 5)
                {
                    Balloon("Sin conexión con la tienda", "Revisá internet. Los cambios se mandan solos cuando vuelva.", ToolTipIcon.Warning, tabStatus);
                    storeWarned = true;
                }
            }
            else { storeErrorSince = null; storeWarned = false; }
        }

        // ---- Acciones ---------------------------------------------------------------

        void SyncNow(bool full)
        {
            if (health == null || !health.Running) { MessageBox.Show(this, "El sincronizador no está corriendo. Tocá «Iniciar» primero.", Text, MessageBoxButtons.OK, MessageBoxIcon.Information); return; }
            var error = Agent.WriteOrder(full ? "full" : "sync");
            if (error != null) MessageBox.Show(this, error, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            else Balloon(full ? "Pasada completa pedida" : "Sincronizando", "En unos segundos el sincronizador hace la pasada.", ToolTipIcon.Info, tabLog);
        }

        void TogglePause()
        {
            var c = Config.Load();
            if (c == null) { MessageBox.Show(this, BrokenConfig, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            bool paused = Json.Bool(c, "paused") == true;
            if (paused) c.Remove("paused"); else c["paused"] = true;
            var error = Config.Save(c);
            if (error != null) { MessageBox.Show(this, error, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            LoadConfigIntoForm(true);
            Tick();
        }

        void RunBusy(string what, Func<string> work, Action<string> done)
        {
            busy = true;
            UseWaitCursor = true;
            bannerTitle.Text = what;
            Task.Factory.StartNew(() =>
            {
                try { return work(); } catch (Exception e) { return "Error: " + e.Message; }
            }).ContinueWith(t =>
            {
                busy = false;
                UseWaitCursor = false;
                Tick();
                done(t.Result);
            }, TaskScheduler.FromCurrentSynchronizationContext());
        }

        void StartAgent()
        {
            RunBusy("Iniciando…", () =>
            {
                if (!Agent.TaskExists())
                    return "NO_TASK";
                var error = Agent.Schtasks("run");
                if (error != null) return error;
                for (int i = 0; i < 20 && !Agent.IsRunning((string)null); i++) Thread.Sleep(500);
                return Agent.IsRunning((string)null) ? null : "Se pidió iniciarlo pero no arrancó: mirá la bitácora o tocá «Revisar todo».";
            }, result =>
            {
                if (result == "NO_TASK")
                {
                    var answer = MessageBox.Show(this, "El sincronizador no está instalado como tarea de Windows (hay que correr install.ps1 como administrador).\n\n¿Abrirlo igual ahora? Va a funcionar hasta que se cierre la sesión de Windows.", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                    if (answer == DialogResult.Yes)
                    {
                        var err = Agent.StartManual();
                        if (err != null) MessageBox.Show(this, err, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    }
                }
                else if (result != null) MessageBox.Show(this, result, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            });
        }

        void RestartAgent()
        {
            var pidValue = Json.Num(health != null ? health.Status : null, "pid");
            RunBusy("Reiniciando…", () =>
            {
                bool hasTask = Agent.TaskExists();
                if (hasTask) Agent.Schtasks("end");
                Agent.KillManual();
                for (int i = 0; i < 20 && Agent.IsRunning((string)null); i++) Thread.Sleep(500);
                if (Agent.IsRunning((string)null) && pidValue != null)
                {
                    // Abierto a mano por otro lado: se cierra ese proceso.
                    try { Process.GetProcessById((int)pidValue.Value).Kill(); } catch { }
                    Thread.Sleep(1500);
                }
                if (Agent.IsRunning((string)null)) return "No se pudo cerrar el sincronizador. Probá reiniciar la PC.";
                if (!hasTask) return Agent.StartManual();
                var error = Agent.Schtasks("run");
                if (error != null) return error;
                for (int i = 0; i < 20 && !Agent.IsRunning((string)null); i++) Thread.Sleep(500);
                return Agent.IsRunning((string)null) ? null : "Se cerró pero no volvió a arrancar: mirá la bitácora o tocá «Revisar todo».";
            }, result => { if (result != null) MessageBox.Show(this, result, Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); });
        }

        void RunCheck()
        {
            var node = Agent.FindNode();
            if (node == null) { MessageBox.Show(this, "No se encontró Node.js en esta PC (nodejs.org, versión LTS).", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            RunBusy("Revisando…", () =>
            {
                string output;
                Agent.Run(node, "--disable-warning=ExperimentalWarning \"" + Path.Combine(Agent.Root, "src", "check.mjs") + "\"", out output, 120000);
                return output;
            }, output => ShowText("Revisión", output));
        }

        void ShowText(string title, string text)
        {
            var f = new Form { Text = title, Size = new Size(820, 520), StartPosition = FormStartPosition.CenterParent, Font = Font, Icon = Icon };
            var box = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill, Font = new Font("Consolas", 10f), Text = (text ?? "").Replace("\r\n", "\n").Replace("\n", "\r\n"), BackColor = SystemColors.Window };
            var bar = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
            bar.Controls.Add(MakeButton("Cerrar", (s, e) => f.Close()));
            bar.Controls.Add(MakeButton("Copiar", (s, e) => { try { Clipboard.SetText(box.Text); } catch { } }));
            f.Controls.Add(box);
            f.Controls.Add(bar);
            box.SelectionStart = 0;
            f.ShowDialog(this);
        }

        void OpenConsole()
        {
            var node = Agent.FindNode();
            if (node == null) { MessageBox.Show(this, "No se encontró Node.js en esta PC.", Text, MessageBoxButtons.OK, MessageBoxIcon.Warning); return; }
            var cmd = "/k title Sincronizador (diagnóstico: cerrá esta ventana para terminar) && \"" + node + "\" --disable-warning=ExperimentalWarning \"" + Path.Combine(Agent.Root, "src", "index.mjs") + "\"";
            Process.Start(new ProcessStartInfo("cmd.exe", cmd) { WorkingDirectory = Agent.Root, UseShellExecute = true });
        }

        void OpenStorePanel()
        {
            var url = (Json.Str(config, "storeUrl") ?? "").TrimEnd('/');
            if (url.Length == 0) { MessageBox.Show(this, "Falta la dirección de la tienda en la configuración.", Text); return; }
            Agent.OpenUrl(url + "/app/aronium");
        }

        // ---- Pestaña Bitácora -----------------------------------------------------------

        void BuildLog()
        {
            var bar = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, Padding = new Padding(10, 10, 10, 2) };
            logOnlyErrors = new CheckBox { Text = "Solo errores y avisos", AutoSize = true, Margin = new Padding(0, 6, 16, 8) };
            logOnlyErrors.CheckedChanged += (s, e) => RefreshLog(true);
            bar.Controls.Add(logOnlyErrors);
            bar.Controls.Add(MakeButton("Actualizar", (s, e) => RefreshLog(true)));
            bar.Controls.Add(MakeButton("Copiar todo", (s, e) => { try { Clipboard.SetText(logBox.Text); } catch { } }));
            bar.Controls.Add(MakeButton("Abrir connector.log", (s, e) => { if (File.Exists(Agent.LogPath)) Process.Start("notepad.exe", "\"" + Agent.LogPath + "\""); }));
            logBox = new RichTextBox { Dock = DockStyle.Fill, ReadOnly = true, Font = new Font("Consolas", 9.5f), BackColor = SystemColors.Window, BorderStyle = BorderStyle.None, WordWrap = true, DetectUrls = false };
            var holder = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10) };
            holder.Controls.Add(logBox);
            tabLog.Controls.Add(holder);
            tabLog.Controls.Add(bar);
        }

        static List<string> ReadLogTail(int maxBytes)
        {
            var lines = new List<string>();
            if (!File.Exists(Agent.LogPath)) return lines;
            using (var stream = new FileStream(Agent.LogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            {
                long start = Math.Max(0, stream.Length - maxBytes);
                stream.Seek(start, SeekOrigin.Begin);
                using (var reader = new StreamReader(stream, Encoding.UTF8))
                {
                    if (start > 0) reader.ReadLine();
                    string line;
                    while ((line = reader.ReadLine()) != null) if (line.Length > 0) lines.Add(line);
                }
            }
            return lines;
        }

        static string LocalLine(string line, out bool isError, out bool isWarning)
        {
            string message = line;
            string when = "";
            int space = line.IndexOf(' ');
            DateTime t;
            if (space > 0 && DateTime.TryParse(line.Substring(0, space), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out t))
            {
                when = t.ToLocalTime().ToString("dd/MM HH:mm:ss");
                message = line.Substring(space + 1);
            }
            isError = message.StartsWith("ERROR") || message.Contains(": ERROR") || message.Contains("ERROR Pedido");
            isWarning = !isError && (message.Contains("ocupado") || message.Contains("desactivados") || message.Contains("ausad") || message.Contains("Aviso:"));
            return (when.Length > 0 ? when + "  " : "") + message;
        }

        void RefreshLog(bool force)
        {
            long stamp = 0;
            try { if (File.Exists(Agent.LogPath)) { var info = new FileInfo(Agent.LogPath); stamp = info.Length ^ info.LastWriteTimeUtc.Ticks; } } catch { }
            if (!force && stamp == logStamp) return;
            List<string> lines;
            try { lines = ReadLogTail(300 * 1024); } catch { return; }
            logStamp = stamp;
            if (lines.Count > 0)
            {
                bool e1, w1;
                lastLogLine = LocalLine(lines[lines.Count - 1], out e1, out w1);
            }
            facts["activity"].Text = lastLogLine.Length > 0 ? lastLogLine : "—";
            if (tabs.SelectedTab != tabLog && !force) return;

            logBox.SuspendLayout();
            logBox.Clear();
            foreach (var raw in lines.Skip(Math.Max(0, lines.Count - 1500)))
            {
                bool isError, isWarning;
                var text = LocalLine(raw, out isError, out isWarning);
                if (logOnlyErrors.Checked && !isError && !isWarning) continue;
                logBox.SelectionStart = logBox.TextLength;
                logBox.SelectionColor = isError ? Color.FromArgb(190, 30, 30) : isWarning ? Color.FromArgb(160, 100, 0) : SystemColors.ControlText;
                logBox.AppendText(text + "\n");
            }
            if (logBox.TextLength == 0) logBox.Text = File.Exists(Agent.LogPath) ? "(nada para mostrar)" : "Todavía no hay bitácora (" + Agent.LogPath + ").";
            logBox.SelectionStart = logBox.TextLength;
            logBox.ScrollToCaret();
            logBox.ResumeLayout();
        }

        // ---- Pestaña Pedidos web --------------------------------------------------------

        void BuildOrders()
        {
            ordersLabel = new Label { Dock = DockStyle.Top, AutoSize = false, Height = 52, Padding = new Padding(12, 10, 12, 0) };
            ordersList = new ListView { View = View.Details, FullRowSelect = true, Dock = DockStyle.Fill, BorderStyle = BorderStyle.None };
            foreach (var col in new[] { new object[] { "Código", 130 }, new object[] { "Cliente", 240 }, new object[] { "Total", 130 }, new object[] { "Proforma", 130 }, new object[] { "Fecha", 120 } })
                ordersList.Columns.Add((string)col[0], (int)col[1]);
            var holder = new Panel { Dock = DockStyle.Fill, Padding = new Padding(10) };
            holder.Controls.Add(ordersList);
            tabOrders.Controls.Add(holder);
            tabOrders.Controls.Add(ordersLabel);
        }

        void RefreshAlerts()
        {
            DateTime stamp;
            try { stamp = File.Exists(Agent.AlertsPath) ? File.GetLastWriteTimeUtc(Agent.AlertsPath) : DateTime.MinValue; } catch { return; }
            if (stamp == alertsStamp && alerts != null) return;
            alertsStamp = stamp;
            alerts = Json.ReadFile(Agent.AlertsPath);

            ordersList.BeginUpdate();
            ordersList.Items.Clear();
            var pending = Json.List(alerts, "pending").ToList();
            var errors = Json.List(alerts, "errors").ToList();
            foreach (var p in pending)
            {
                var date = Json.Date(p, "created_at");
                var row = new ListViewItem(Json.Str(p, "code") ?? "");
                row.SubItems.Add(Json.Str(p, "customer") ?? "");
                row.SubItems.Add(Fmt.Money(Json.Num(p, "total"), Json.Str(p, "currency")));
                row.SubItems.Add(Json.Str(p, "quote") ?? "");
                row.SubItems.Add(date != null ? date.Value.ToString("dd/MM HH:mm") : "");
                ordersList.Items.Add(row);
            }
            foreach (var e in errors)
            {
                var row = new ListViewItem(Json.Str(e, "code") ?? "");
                row.SubItems.Add("CON ERROR: " + Json.Str(e, "message"));
                row.ForeColor = Color.DarkRed;
                ordersList.Items.Add(row);
            }
            ordersList.EndUpdate();
            var blocked = Json.Str(alerts, "blocked");
            ordersLabel.ForeColor = blocked != null ? Color.DarkRed : SystemColors.ControlText;
            ordersLabel.Text = blocked != null ? "PEDIDOS WEB EN PAUSA: " + blocked
                : ordersList.Items.Count == 0 ? "No hay pedidos web esperando pago."
                : "Cuando el cliente pague, buscá la proforma en Aronium (por el código PW-…) y marcala «Pagado»: la venta se crea sola.";
            tabOrders.Text = pending.Count > 0 ? "Pedidos web (" + pending.Count + ")" : "Pedidos web";

            NotifyOrders(pending, errors, blocked);
        }

        void NotifyOrders(List<Dictionary<string, object>> pending, List<Dictionary<string, object>> errors, string blocked)
        {
            if (!Config.AlertsEnabled(config) || alerts == null) return;
            if (blocked != null && blocked != blockedWarned)
                Balloon("Pedidos web en pausa", blocked, ToolTipIcon.Warning, tabOrders);
            blockedWarned = blocked;

            var fresh = pending.Where(p => Json.Str(p, "code") != null && !seen.Contains(Json.Str(p, "code"))).ToList();
            var freshErrors = errors.Where(e => Json.Str(e, "code") != null && !seen.Contains("error:" + Json.Str(e, "code"))).ToList();
            if (fresh.Count == 1)
            {
                var p = fresh[0];
                Balloon("Pedido web " + Json.Str(p, "code"), Json.Str(p, "customer") + " — " + Fmt.Money(Json.Num(p, "total"), Json.Str(p, "currency")) + "\nProforma " + Json.Str(p, "quote") + " en Aronium: marcala «Pagado» cuando cobres.", ToolTipIcon.Info, tabOrders);
            }
            else if (fresh.Count > 1)
                Balloon(fresh.Count + " pedidos web nuevos", string.Join("\n", fresh.Select(p => Json.Str(p, "code") + " — " + Json.Str(p, "customer"))), ToolTipIcon.Info, tabOrders);
            else if (freshErrors.Count > 0)
                Balloon("Pedido web " + Json.Str(freshErrors[0], "code") + " con error", Json.Str(freshErrors[0], "message"), ToolTipIcon.Warning, tabOrders);
            if (fresh.Count + freshErrors.Count == 0) return;
            foreach (var p in fresh) seen.Add(Json.Str(p, "code"));
            foreach (var e in freshErrors) seen.Add("error:" + Json.Str(e, "code"));
            try
            {
                Directory.CreateDirectory(Agent.UserDir);
                File.WriteAllLines(seenPath, seen.Skip(Math.Max(0, seen.Count - 500)), Encoding.UTF8);
            }
            catch { }
        }

        // ---- Pestaña Configuración ------------------------------------------------------

        TableLayoutPanel configGrid;

        void Section(string title)
        {
            var label = new Label { Text = title, AutoSize = true, Font = new Font("Segoe UI Semibold", 11f), Margin = new Padding(0, 16, 0, 4) };
            configGrid.Controls.Add(label);
            configGrid.SetColumnSpan(label, 2);
        }

        T Field<T>(string label, T control, string help) where T : Control
        {
            configGrid.Controls.Add(new Label { Text = label, AutoSize = true, Margin = new Padding(0, 7, 12, 0) });
            var cell = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0, 2, 0, 4), Dock = DockStyle.Fill };
            control.Margin = new Padding(0);
            cell.Controls.Add(control);
            if (help != null) cell.Controls.Add(new Label { Text = help, AutoSize = true, ForeColor = SystemColors.GrayText, MaximumSize = new Size(560, 0), Margin = new Padding(0, 2, 0, 0) });
            configGrid.Controls.Add(cell);
            HookDirty(control);
            return control;
        }

        CheckBox Check(string text, string help)
        {
            var box = new CheckBox { Text = text, AutoSize = true };
            configGrid.Controls.Add(new Label { AutoSize = true });
            var cell = new FlowLayoutPanel { FlowDirection = FlowDirection.TopDown, AutoSize = true, WrapContents = false, Margin = new Padding(0, 2, 0, 4) };
            cell.Controls.Add(box);
            if (help != null) cell.Controls.Add(new Label { Text = help, AutoSize = true, ForeColor = SystemColors.GrayText, MaximumSize = new Size(560, 0), Margin = new Padding(18, 0, 0, 0) });
            configGrid.Controls.Add(cell);
            HookDirty(box);
            return box;
        }

        void HookDirty(Control c)
        {
            EventHandler dirty = (s, e) =>
            {
                if (loadingConfig) return;
                configDirty = true;
                configNote.Text = "Hay cambios sin guardar.";
                configNote.ForeColor = Color.FromArgb(160, 100, 0);
            };
            if (c is TextBox) c.TextChanged += dirty;
            else if (c is NumericUpDown) ((NumericUpDown)c).ValueChanged += dirty;
            else if (c is CheckBox) ((CheckBox)c).CheckedChanged += dirty;
            else foreach (Control child in c.Controls) HookDirty(child);
        }

        static TextBox Box(int width, bool secret = false)
        {
            return new TextBox { Width = width, UseSystemPasswordChar = secret };
        }

        Control WithButton(TextBox box, string text, EventHandler click)
        {
            var row = new FlowLayoutPanel { AutoSize = true, WrapContents = false, Margin = new Padding(0) };
            box.Margin = new Padding(0, 1, 6, 0);
            row.Controls.Add(box);
            var b = MakeButton(text, click);
            b.Margin = new Padding(0);
            row.Controls.Add(b);
            return row;
        }

        void BuildConfig()
        {
            var bar = new FlowLayoutPanel { Dock = DockStyle.Bottom, AutoSize = true, Padding = new Padding(12, 8, 12, 4), BackColor = SystemColors.Control };
            bar.Controls.Add(MakeButton("Guardar", (s, e) => SaveConfig()));
            bar.Controls.Add(MakeButton("Deshacer cambios", (s, e) => LoadConfigIntoForm(true)));
            bar.Controls.Add(MakeButton("Revisar todo", (s, e) => { if (configDirty && SaveConfig() == false) return; RunCheck(); }));
            bar.Controls.Add(MakeButton("Editar config.json a mano", (s, e) => Process.Start("notepad.exe", "\"" + Agent.ConfigPath + "\"")));
            configNote = new Label { AutoSize = true, Margin = new Padding(8, 8, 0, 0) };
            bar.Controls.Add(configNote);

            configGrid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 2, Padding = new Padding(16, 4, 16, 16) };
            configGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 230));
            configGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            var scroll = new Panel { Dock = DockStyle.Fill, AutoScroll = true };
            scroll.Controls.Add(configGrid);

            Section("Tienda online (API)");
            cfStoreUrl = Field("Dirección de la tienda", Box(420), "La del servidor (Railway), p. ej. https://erelojesadmin.up.railway.app");
            cfToken = Box(420, true);
            Field("Clave del conector", cfToken, "arag_… — se genera en el panel → Aronium → «Generar clave». Una clave nueva anula la anterior.");
            cfShowToken = new CheckBox { Text = "Mostrar las claves", AutoSize = true };
            cfShowToken.CheckedChanged += (s, e) => { cfToken.UseSystemPasswordChar = cfApiKey.UseSystemPasswordChar = !cfShowToken.Checked; };
            configGrid.Controls.Add(new Label { AutoSize = true });
            configGrid.Controls.Add(cfShowToken);
            cfApiKey = Field("Clave de administrador (vieja)", Box(420, true), "Solo si no hay clave del conector. Con esta solo sincroniza el catálogo, sin pedidos web.");

            Section("Aronium");
            cfDb = Box(420);
            Field("Base de datos (pos.db)", WithButton(cfDb, "Buscar…", (s, e) => BrowseDb()), "Aronium → Configuración → Base de datos → «Abrir ubicación». Ruta completa (la tarea corre con la cuenta del sistema).");
            cfWarehouse = Field("Depósito (número)", Box(80), "Vacío: suma el stock de todos los depósitos.");

            Section("Sincronización");
            cfInterval = Field("Cada cuántos minutos", new NumericUpDown { Minimum = 1, Maximum = 30, Width = 80 }, null);
            cfIntervalFromPanel = Check("El panel de la tienda puede cambiar la frecuencia", "Sin marcar: vale siempre la de acá, aunque en el panel pongan otra.");

            Section("Pedidos web → Aronium");
            cfWebSales = Check("Registrar los pedidos web en Aronium (proforma y venta)", "Sin marcar: solo sincroniza el catálogo (Aronium → tienda).");
            cfUser = Field("Usuario de Aronium", Box(240), "El que figura en las ventas web. Vacío: el usuario principal.");
            cfCustomer = Field("Cliente «consumidor final»", Box(240), "Como se llama en Aronium (p. ej. Unknown o Walk-in customer).");
            cfPayTransfer = Field("Forma de pago: transferencia", Box(240), "Nombre exacto de la forma de pago en Aronium (p. ej. Itaú).");
            cfPayCash = Field("Forma de pago: contra entrega", Box(240), "P. ej. Efectivo.");
            cfShipping = Field("Código del envío", Box(160), "Producto-servicio de Aronium para el costo de envío.");
            cfServiceType = Field("Tipo de servicio", Box(80), "Vacío: el que más usan las ventas de la caja.");

            Section("Copias de respaldo de Aronium");
            cfBackupDir = Box(420);
            Field("Carpeta", WithButton(cfBackupDir, "Buscar…", (s, e) => BrowseFolder(cfBackupDir)), "Vacío: la carpeta backups del sincronizador. Se hace una copia por día, antes de escribir el primer pedido.");
            cfKeepBackups = Field("Cuántas guardar", new NumericUpDown { Minimum = 1, Maximum = 365, Width = 80 }, null);

            Section("Este programa");
            cfAlerts = Check("Avisos de pedidos web junto al reloj", "Un globo de Windows cuando entra un pedido web o uno tiene error (lo que antes hacía avisos.ps1).");
            cfAgentDown = Check("Avisar si el sincronizador se detiene o se queda sin conexión", null);

            tabConfig.Controls.Add(scroll);
            tabConfig.Controls.Add(bar);
        }

        void BrowseDb()
        {
            using (var dialog = new OpenFileDialog { Filter = "Base de Aronium (pos.db)|*.db|Todos los archivos|*.*", Title = "Base de datos de Aronium" })
            {
                try { if (File.Exists(cfDb.Text)) dialog.InitialDirectory = Path.GetDirectoryName(cfDb.Text); } catch { }
                if (string.IsNullOrEmpty(dialog.InitialDirectory)) dialog.InitialDirectory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Aronium", "Data");
                if (dialog.ShowDialog(this) == DialogResult.OK) cfDb.Text = dialog.FileName;
            }
        }

        void BrowseFolder(TextBox box)
        {
            using (var dialog = new FolderBrowserDialog { SelectedPath = box.Text })
                if (dialog.ShowDialog(this) == DialogResult.OK) box.Text = dialog.SelectedPath;
        }

        void ReloadConfigIfChanged()
        {
            DateTime stamp;
            try { stamp = File.GetLastWriteTimeUtc(Agent.ConfigPath); } catch { return; }
            if (stamp == configStamp) return;
            // Cambió por fuera (Bloc de notas, Pausar): se recarga si no hay cambios a medio guardar.
            LoadConfigIntoForm(!configDirty);
        }

        void LoadConfigIntoForm(bool intoFields)
        {
            try { configStamp = File.GetLastWriteTimeUtc(Agent.ConfigPath); } catch { }
            config = Config.Load();
            bool broken = config == null;
            if (broken) config = new Dictionary<string, object>();
            if (!intoFields) return;
            loadingConfig = true;
            var web = Json.Obj(config, "webSales");
            var pay = Json.Obj(web, "paymentTypes");
            var alertsCfg = Json.Obj(config, "alerts");
            cfStoreUrl.Text = Json.Str(config, "storeUrl") ?? "";
            cfToken.Text = Json.Str(config, "token") ?? "";
            cfApiKey.Text = Json.Str(config, "apiKey") ?? "";
            cfDb.Text = Json.Str(config, "aroniumDb") ?? "";
            cfWarehouse.Text = Json.Str(config, "warehouseId") ?? "";
            cfInterval.Value = Math.Max(1, Math.Min(30, (decimal)(Json.Num(config, "intervalMinutes") ?? 1)));
            cfIntervalFromPanel.Checked = Json.Bool(config, "intervalFromPanel") != false;
            cfWebSales.Checked = Json.Bool(web, "enabled") != false;
            cfUser.Text = Json.Str(web, "userName") ?? "";
            cfCustomer.Text = Json.Str(web, "defaultCustomerName") ?? "Walk-in customer";
            cfPayTransfer.Text = Json.Str(pay, "bank_transfer") ?? "Itaú";
            cfPayCash.Text = Json.Str(pay, "cash_on_delivery") ?? "Efectivo";
            cfShipping.Text = Json.Str(web, "shippingCode") ?? "ENVIO";
            cfServiceType.Text = Json.Str(web, "serviceType") ?? "";
            cfBackupDir.Text = Json.Str(config, "backupDir") ?? "";
            cfKeepBackups.Value = Math.Max(1, Math.Min(365, (decimal)(Json.Num(config, "keepBackups") ?? 14)));
            cfAlerts.Checked = Json.Bool(alertsCfg, "enabled") != false;
            cfAgentDown.Checked = Json.Bool(alertsCfg, "agentDown") != false;
            loadingConfig = false;
            configDirty = false;
            configNote.Text = broken ? BrokenConfig : File.Exists(Agent.ConfigPath) ? "Los cambios se aplican solos al guardar (no hace falta reiniciar)." : "No existe config.json: completá los datos y guardá.";
            configNote.ForeColor = broken ? Color.DarkRed : SystemColors.GrayText;
        }

        const string BrokenConfig = "config.json tiene un error y no se puede leer (¿lo editaron a mano?). Abrilo con «Editar config.json a mano» y corregilo, o completá esta pantalla y guardá para reemplazarlo.";

        static void SetOrRemove(Dictionary<string, object> d, string key, string value)
        {
            value = (value ?? "").Trim();
            if (value.Length == 0) d.Remove(key); else d[key] = value;
        }

        bool SaveConfig()
        {
            var url = cfStoreUrl.Text.Trim().TrimEnd('/');
            var problems = new List<string>();
            if (!url.StartsWith("http://") && !url.StartsWith("https://")) problems.Add("La dirección de la tienda tiene que empezar con https://");
            if (cfToken.Text.Trim().Length == 0 && cfApiKey.Text.Trim().Length == 0) problems.Add("Falta la clave del conector.");
            int n;
            if (cfWarehouse.Text.Trim().Length > 0 && !int.TryParse(cfWarehouse.Text.Trim(), out n)) problems.Add("El depósito tiene que ser un número (o vacío).");
            if (cfServiceType.Text.Trim().Length > 0 && !int.TryParse(cfServiceType.Text.Trim(), out n)) problems.Add("El tipo de servicio tiene que ser un número (o vacío).");
            if (problems.Count > 0) { MessageBox.Show(this, string.Join("\n", problems), "No se guardó", MessageBoxButtons.OK, MessageBoxIcon.Warning); return false; }
            var warnings = new List<string>();
            var token = cfToken.Text.Trim();
            if (token.Length > 0 && !token.StartsWith("arag_")) warnings.Add("La clave del conector normalmente empieza con arag_.");
            var db = Environment.ExpandEnvironmentVariables(cfDb.Text.Trim().Replace('/', '\\'));
            if (db.Length > 0 && !File.Exists(db)) warnings.Add("No existe el archivo de la base de Aronium:\n" + db);
            if (db.Contains("%")) warnings.Add("La ruta de Aronium tiene %…%: la tarea corre con la cuenta del sistema, conviene la ruta completa.");
            if (warnings.Count > 0 && MessageBox.Show(this, string.Join("\n\n", warnings) + "\n\n¿Guardar igual?", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return false;

            // Sobre lo que hay en el archivo: se conservan las claves que el programa no muestra.
            var c = Config.Load();
            if (c == null)
            {
                if (MessageBox.Show(this, "config.json tiene un error y no se puede leer. ¿Reemplazarlo con lo que hay en esta pantalla? (La versión rota queda en " + Path.Combine(Agent.UserDir, "config-anterior.json") + ".)", Text, MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return false;
                c = new Dictionary<string, object>();
            }
            c["storeUrl"] = url;
            SetOrRemove(c, "token", token);
            SetOrRemove(c, "apiKey", cfApiKey.Text);
            SetOrRemove(c, "aroniumDb", cfDb.Text);
            if (cfWarehouse.Text.Trim().Length > 0) c["warehouseId"] = int.Parse(cfWarehouse.Text.Trim()); else c["warehouseId"] = null;
            c["intervalMinutes"] = (int)cfInterval.Value;
            if (cfIntervalFromPanel.Checked) c.Remove("intervalFromPanel"); else c["intervalFromPanel"] = false;
            SetOrRemove(c, "backupDir", cfBackupDir.Text);
            if ((int)cfKeepBackups.Value == 14) c.Remove("keepBackups"); else c["keepBackups"] = (int)cfKeepBackups.Value;
            var web = Json.ObjOrNew(c, "webSales");
            web["enabled"] = cfWebSales.Checked;
            web["userName"] = cfUser.Text.Trim();
            web["defaultCustomerName"] = cfCustomer.Text.Trim();
            var pay = Json.ObjOrNew(web, "paymentTypes");
            pay["bank_transfer"] = cfPayTransfer.Text.Trim();
            pay["cash_on_delivery"] = cfPayCash.Text.Trim();
            web["shippingCode"] = cfShipping.Text.Trim().Length > 0 ? cfShipping.Text.Trim() : "ENVIO";
            if (cfServiceType.Text.Trim().Length > 0) web["serviceType"] = int.Parse(cfServiceType.Text.Trim()); else web.Remove("serviceType");
            var alertsCfg = Json.ObjOrNew(c, "alerts");
            alertsCfg["enabled"] = cfAlerts.Checked;
            alertsCfg["agentDown"] = cfAgentDown.Checked;

            var error = Config.Save(c);
            if (error != null) { MessageBox.Show(this, error, "No se guardó", MessageBoxButtons.OK, MessageBoxIcon.Error); return false; }
            LoadConfigIntoForm(true);
            configNote.Text = "Guardado " + DateTime.Now.ToString("HH:mm") + ". El sincronizador lo toma solo en la próxima pasada (la versión anterior quedó en " + Path.Combine(Agent.UserDir, "config-anterior.json") + ").";
            configNote.ForeColor = Color.FromArgb(46, 130, 60);
            if (health != null && health.Running) Agent.WriteOrder("sync");
            return true;
        }
    }
}
