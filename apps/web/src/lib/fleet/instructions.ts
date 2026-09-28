// How to create a least-privilege account per profile type (ADR-0007, docs/specs/fleet-ui.md §5.E). Drafts from the
// design, adjusted to the transport decisions (Windows and RouterOS over SSH); they move into the product modules
// with S6-T4. `{instance}` is this instance's address, `{key}` the profile's public key.
import inventoryScript from '../../../static/downloads/versiondrift-inventory?raw';
import type { Locale } from '$lib/i18n';

export type ProfileType = 'linux' | 'windows' | 'mikrotik' | 'pve' | 'pbs';
export const PROFILE_TYPES: ProfileType[] = ['linux', 'windows', 'mikrotik', 'pve', 'pbs'];

export const KIND_OF: Record<ProfileType, 'ssh-linux' | 'windows' | 'routeros' | 'proxmox'> = {
  linux: 'ssh-linux',
  windows: 'windows',
  mikrotik: 'routeros',
  pve: 'proxmox',
  pbs: 'proxmox',
};

export interface Instructions {
  label: string;
  transport: string;
  name: string;
  user: string;
  /** What the secret field is; absent for Linux (the instance makes a key). */
  secret?: string;
  lead: string;
  steps: { text: string; code?: string }[];
  note: string;
  rights: string;
}

const script = inventoryScript.trimEnd();
const installScript = `sudo tee /usr/local/bin/versiondrift-inventory >/dev/null <<'EOF'\n${script}\nEOF\nsudo chmod 755 /usr/local/bin/versiondrift-inventory`;
const authorizedKey =
  'sudo install -d -m 700 -o versiondrift ~versiondrift/.ssh\necho \'restrict,command="/usr/local/bin/versiondrift-inventory" {key}\' \\\n  | sudo tee ~versiondrift/.ssh/authorized_keys';

const RU: Record<ProfileType, Instructions> = {
  linux: {
    label: 'Linux',
    transport: 'SSH по ключу',
    name: 'Linux SSH (только чтение)',
    user: 'versiondrift',
    lead: 'Отдельный пользователь без sudo. Ключ VersionDrift может выполнить только одну команду — скрипт, который читает версии пакетов.',
    steps: [
      {
        text: 'Создайте системного пользователя без sudo:',
        code: 'sudo useradd --system --create-home --shell /bin/sh versiondrift',
      },
      {
        text: 'Положите скрипт сбора версий. Он только читает /etc/os-release и список пакетов:',
        code: installScript,
      },
      {
        text: 'Разрешите ключу этого экземпляра только эту команду (ключ появится на следующем шаге):',
        code: authorizedKey,
      },
    ],
    note: 'Ключ VersionDrift создаёт сам: закрытая часть хранится зашифрованной в этом экземпляре, открытую вы увидите после сохранения.',
    rights: 'Отдельный пользователь без sudo. Ключ может выполнить только одну команду сбора версий.',
  },
  windows: {
    label: 'Windows',
    transport: 'SSH (OpenSSH)',
    name: 'Windows RO',
    user: 'versiondrift',
    secret: 'Пароль',
    lead: 'Обычный локальный или доменный пользователь, не администратор. VersionDrift заходит по SSH и читает номер сборки из реестра.',
    steps: [
      {
        text: 'Включите встроенный OpenSSH Server (Windows Server 2019 и новее; для 2016 поставьте пакет OpenSSH):',
        code: "Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0\nStart-Service sshd\nSet-Service -Name sshd -StartupType 'Automatic'",
      },
      { text: 'Создайте пользователя (пароль будет запрошен):', code: 'net user versiondrift * /add' },
      {
        text: 'Отключите срок действия пароля, иначе опрос однажды получит отказ в доступе:',
        code: 'Set-LocalUser -Name versiondrift -PasswordNeverExpires $true',
      },
    ],
    note: 'Не добавляйте учётку в Administrators — VersionDrift это не нужно. У локальных учёток пароль задаётся на каждом хосте отдельно; доменная учётка — одна на все.',
    rights: 'Обычный пользователь, не администратор. Вход по SSH, чтение реестра.',
  },
  mikrotik: {
    label: 'MikroTik',
    transport: 'SSH',
    name: 'MikroTik SSH (read)',
    user: 'versiondrift',
    secret: 'Пароль',
    lead: 'Группа только с правами read и ssh, вход только с адреса VersionDrift. Работает на RouterOS 6 и 7.',
    steps: [
      {
        text: 'Создайте группу, которая может только читать:',
        code: '/user group add name=vd-read policy=read,ssh',
      },
      {
        text: 'Создайте пользователя и разрешите вход только с адреса VersionDrift:',
        code: '/user add name=versiondrift group=vd-read address={instance}/32 password=…',
      },
      { text: 'Убедитесь, что включён сервис SSH (IP → Services, порт 22).' },
    ],
    note: '{instance} — адрес этого экземпляра VersionDrift, подставлен автоматически; если роутер видит его под другим адресом, поправьте.',
    rights: 'Группа только с политиками read и ssh. Вход разрешён только с адреса VersionDrift.',
  },
  pve: {
    label: 'Proxmox VE',
    transport: 'API-токен',
    name: 'Proxmox VE (PVEAuditor)',
    user: 'versiondrift@pve!vd',
    secret: 'Секрет токена',
    lead: 'API-токен с ролью PVEAuditor — только чтение.',
    steps: [
      {
        text: 'Создайте пользователя:',
        code: 'pveum user add versiondrift@pve --comment "VersionDrift, read-only"',
      },
      {
        text: 'Выдайте роль PVEAuditor на весь кластер:',
        code: 'pveum acl modify / --users versiondrift@pve --roles PVEAuditor',
      },
      {
        text: 'Создайте токен и скопируйте его секрет:',
        code: 'pveum user token add versiondrift@pve vd --privsep 0',
      },
    ],
    note: 'Секрет токена показывается один раз — вставьте его на следующем шаге.',
    rights: 'Роль PVEAuditor — только чтение.',
  },
  pbs: {
    label: 'Proxmox Backup',
    transport: 'API-токен',
    name: 'Proxmox Backup (Audit)',
    user: 'versiondrift@pbs!vd',
    secret: 'Секрет токена',
    lead: 'API-токен с ролью Audit — только чтение.',
    steps: [
      { text: 'Создайте пользователя:', code: 'proxmox-backup-manager user create versiondrift@pbs' },
      {
        text: 'Создайте токен и скопируйте его секрет:',
        code: 'proxmox-backup-manager user generate-token versiondrift@pbs vd',
      },
      {
        text: 'Выдайте токену роль Audit:',
        code: "proxmox-backup-manager acl update / Audit --auth-id 'versiondrift@pbs!vd'",
      },
    ],
    note: 'Секрет токена показывается один раз — вставьте его на следующем шаге.',
    rights: 'Роль Audit — только чтение.',
  },
};

const EN: Record<ProfileType, Instructions> = {
  linux: {
    ...RU.linux,
    transport: 'SSH key',
    name: 'Linux SSH (read-only)',
    lead: 'A separate user without sudo. The VersionDrift key can run one command only: a script that reads package versions.',
    steps: [
      { text: 'Create a system user without sudo:', code: RU.linux.steps[0]!.code! },
      {
        text: 'Install the inventory script. It only reads /etc/os-release and the package list:',
        code: installScript,
      },
      {
        text: 'Allow this instance’s key that one command (the key appears on the next step):',
        code: authorizedKey,
      },
    ],
    note: 'VersionDrift makes the key: the private half stays encrypted in this instance, you see the public one after saving.',
    rights: 'A separate user without sudo. The key can run the inventory command only.',
  },
  windows: {
    ...RU.windows,
    secret: 'Password',
    lead: 'A standard local or domain user, not an administrator. VersionDrift signs in over SSH and reads the build from the registry.',
    steps: [
      {
        text: 'Turn on the built-in OpenSSH Server (Windows Server 2019 and later; install the OpenSSH package on 2016):',
        code: RU.windows.steps[0]!.code!,
      },
      { text: 'Create the user (you will be asked for a password):', code: RU.windows.steps[1]!.code! },
      {
        text: 'Stop the password from expiring, or polls will one day be refused:',
        code: RU.windows.steps[2]!.code!,
      },
    ],
    note: 'Do not add the account to Administrators; VersionDrift does not need it. A local account has its password on each host; a domain account is one for all.',
    rights: 'A standard user, not an administrator. SSH sign-in, reads the registry.',
  },
  mikrotik: {
    ...RU.mikrotik,
    secret: 'Password',
    lead: 'A group with the read and ssh policies only, sign-in only from the VersionDrift address. Works on RouterOS 6 and 7.',
    steps: [
      { text: 'Create a group that can only read:', code: RU.mikrotik.steps[0]!.code! },
      {
        text: 'Create the user and allow sign-in only from the VersionDrift address:',
        code: RU.mikrotik.steps[1]!.code!,
      },
      { text: 'Make sure the SSH service is on (IP → Services, port 22).' },
    ],
    note: '{instance} is this VersionDrift instance’s address, filled in for you; correct it if the router sees it under another one.',
    rights: 'A group with the read and ssh policies only. Sign-in only from the VersionDrift address.',
  },
  pve: {
    ...RU.pve,
    transport: 'API token',
    secret: 'Token secret',
    lead: 'An API token with the PVEAuditor role: read-only.',
    steps: [
      { text: 'Create the user:', code: RU.pve.steps[0]!.code! },
      { text: 'Give it the PVEAuditor role on the whole cluster:', code: RU.pve.steps[1]!.code! },
      { text: 'Create the token and copy its secret:', code: RU.pve.steps[2]!.code! },
    ],
    note: 'The token secret is shown once: paste it on the next step.',
    rights: 'The PVEAuditor role: read-only.',
  },
  pbs: {
    ...RU.pbs,
    transport: 'API token',
    secret: 'Token secret',
    lead: 'An API token with the Audit role: read-only.',
    steps: [
      { text: 'Create the user:', code: RU.pbs.steps[0]!.code! },
      { text: 'Create the token and copy its secret:', code: RU.pbs.steps[1]!.code! },
      { text: 'Give the token the Audit role:', code: RU.pbs.steps[2]!.code! },
    ],
    note: 'The token secret is shown once: paste it on the next step.',
    rights: 'The Audit role: read-only.',
  },
};

export const instructions = (locale: Locale, type: ProfileType): Instructions =>
  (locale === 'ru' ? RU : EN)[type];

export const fill = (text: string, values: { instance: string; key?: string | null }) =>
  text
    .replaceAll('{instance}', values.instance)
    .replaceAll('{key}', values.key ?? 'ssh-ed25519 AAAA… versiondrift');
