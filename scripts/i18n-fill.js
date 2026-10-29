'use strict';
/* Inserts missing keys into the i18n.js dictionaries (en/de/fr/it/bs/sr).
   Run after changes: node scripts/i18n-fill.js  → then node scripts/i18n-coverage.js */
const fs = require('node:fs');
const path = require('node:path');
const R = path.join(__dirname, '..');
const FILE = path.join(R, 'src', 'renderer', 'i18n.js');

const LANGS = ['en', 'de', 'fr', 'it', 'bs', 'sr'];
const ev = (lit) => { try { return eval(lit); } catch { return null; } };

/* translations: Croatian key → { en, de, fr, it, bs, sr } */
const TRANS = {
  'LOCALNO': { en: 'LOCAL', de: 'LOKAL', fr: 'LOCAL', it: 'LOCALE', bs: 'LOKALNO', sr: 'LOKALNO' },
  'Nova mapa': { en: 'New folder', de: 'Neuer Ordner', fr: 'Nouveau dossier', it: 'Nuova cartella', bs: 'Nova mapa', sr: 'Nova fascikla' },
  'Preimenuj': { en: 'Rename', de: 'Umbenennen', fr: 'Renommer', it: 'Rinomina', bs: 'Preimenuj', sr: 'Preimenuj' },
  'Obriši': { en: 'Delete', de: 'Löschen', fr: 'Supprimer', it: 'Elimina', bs: 'Obriši', sr: 'Obriši' },
  'Nagore': { en: 'Up', de: 'Nach oben', fr: 'Monter', it: 'Su', bs: 'Nagore', sr: 'Nagore' },
  'Osvježi': { en: 'Refresh', de: 'Neu laden', fr: 'Actualiser', it: 'Aggiorna', bs: 'Osvježi', sr: 'Osveži' },
  '⟳ Osvježi': { en: '⟳ Refresh', de: '⟳ Neu laden', fr: '⟳ Actualiser', it: '⟳ Aggiorna', bs: '⟳ Osvježi', sr: '⟳ Osveži' },
  '＋ Nova mapa': { en: '＋ New folder', de: '＋ Neuer Ordner', fr: '＋ Nouveau dossier', it: '＋ Nuova cartella', bs: '＋ Nova mapa', sr: '＋ Nova fascikla' },
  '⬆ Na gore': { en: '⬆ Up', de: '⬆ Nach oben', fr: '⬆ Monter', it: '⬆ Su', bs: '⬆ Na gore', sr: '⬆ Nagore' },
  '— nema servera —': { en: '— no servers —', de: '— keine Server —', fr: '— aucun serveur —', it: '— nessun server —', bs: '— nema servera —', sr: '— nema servera —' },
  'Odaberi server.': { en: 'Choose a server.', de: 'Server auswählen.', fr: 'Choisir un serveur.', it: 'Scegli un server.', bs: 'Odaberi server.', sr: 'Odaberi server.' },
  'Spajam se na server…': { en: 'Connecting to the server…', de: 'Verbindung wird hergestellt…', fr: 'Connexion au serveur…', it: 'Connessione al server…', bs: 'Spajam se na server…', sr: 'Povezujem se na server…' },
  'Ne mogu dohvatiti home.': { en: 'Cannot get the home directory.', de: 'Home-Verzeichnis nicht ermittelbar.', fr: 'Impossible d\u2019obtenir le dossier personnel.', it: 'Impossibile ottenere la home.', bs: 'Ne mogu dohvatiti home.', sr: 'Ne mogu dohvatiti home.' },
  'Prvo odaberi mapu.': { en: 'Choose a folder first.', de: 'Wähle zuerst einen Ordner.', fr: 'Choisis d\u2019abord un dossier.', it: 'Scegli prima una cartella.', bs: 'Prvo odaberi mapu.', sr: 'Prvo odaberi fasciklu.' },
  'Naziv nove mape:': { en: 'New folder name:', de: 'Name des neuen Ordners:', fr: 'Nom du nouveau dossier :', it: 'Nome della nuova cartella:', bs: 'Naziv nove mape:', sr: 'Naziv nove fascikle:' },
  'Mapa "{0}" bit će obrisana sa SAVIM sadržajem.\nUpiši {1} za potvrdu:': {
    en: 'Folder "{0}" will be deleted with ALL its content.\nType {1} to confirm:',
    de: 'Ordner "{0}" wird mit dem GESAMTEN Inhalt gelöscht.\nTippe {1} zur Bestätigung:',
    fr: 'Le dossier « {0} » sera supprimé avec TOUT son contenu.\nTape {1} pour confirmer :',
    it: 'La cartella "{0}" sarà eliminata con TUTTO il suo contenuto.\nDigita {1} per confermare:',
    bs: 'Mapa "{0}" bit će obrisana sa SVIM sadržajem.\nUpiši {1} za potvrdu:',
    sr: 'Fascikla "{0}" biće obrisana sa SVIM sadržajem.\nUpiši {1} za potvrdu:',
  },
  'Brisanje greška ({0}): {1}': { en: 'Delete error ({0}): {1}', de: 'Löschfehler ({0}): {1}', fr: 'Erreur de suppression ({0}) : {1}', it: 'Errore di eliminazione ({0}): {1}', bs: 'Brisanje greška ({0}): {1}', sr: 'Brisanje greška ({0}): {1}' },
  'Obrisano.': { en: 'Deleted.', de: 'Gelöscht.', fr: 'Supprimé.', it: 'Eliminato.', bs: 'Obrisano.', sr: 'Obrisano.' },
  'Označi stavke pomoću kvačica.': { en: 'Select items using the checkboxes.', de: 'Markiere Elemente mit den Häkchen.', fr: 'Coche les éléments avec les cases.', it: 'Seleziona gli elementi con le caselle.', bs: 'Označi stavke pomoću kvačica.', sr: 'Označi stavke pomoću kvačica.' },
  'Novo ime za "{0}":': { en: 'New name for "{0}":', de: 'Neuer Name für "{0}":', fr: 'Nouveau nom pour « {0} » :', it: 'Nuovo nome per "{0}":', bs: 'Novo ime za "{0}":', sr: 'Novo ime za "{0}":' },
  'Označi točno jednu stavku.': { en: 'Select exactly one item.', de: 'Wähle genau ein Element.', fr: 'Sélectionne exactement un élément.', it: 'Seleziona esattamente un elemento.', bs: 'Označi tačno jednu stavku.', sr: 'Označi tačno jednu stavku.' },
  'Označi datoteke ili mape kvačicama.': { en: 'Select files or folders using the checkboxes.', de: 'Markiere Dateien oder Ordner mit den Häkchen.', fr: 'Coche des fichiers ou des dossiers avec les cases.', it: 'Seleziona file o cartelle con le caselle.', bs: 'Označi datoteke ili mape kvačicama.', sr: 'Označi datoteke ili fascikle kvačicama.' },
  'Server nije odabran/spojen.': { en: 'Server not selected/connected.', de: 'Server nicht ausgewählt/verbunden.', fr: 'Serveur non sélectionné/connecté.', it: 'Server non selezionato/connesso.', bs: 'Server nije odabran/spojen.', sr: 'Server nije odabran/povezan.' },
  'Upload greška ({0}): {1}': { en: 'Upload error ({0}): {1}', de: 'Upload-Fehler ({0}): {1}', fr: 'Erreur d\u2019envoi ({0}) : {1}', it: 'Errore di upload ({0}): {1}', bs: 'Upload greška ({0}): {1}', sr: 'Upload greška ({0}): {1}' },
  'Poslana cijela mapa: {0}': { en: 'Whole folder sent: {0}', de: 'Ganzer Ordner gesendet: {0}', fr: 'Dossier entier envoyé : {0}', it: 'Intera cartella inviata: {0}', bs: 'Poslana cijela mapa: {0}', sr: 'Poslata cela fascikla: {0}' },
  'Poslano: {0}': { en: 'Sent: {0}', de: 'Gesendet: {0}', fr: 'Envoyé : {0}', it: 'Inviato: {0}', bs: 'Poslano: {0}', sr: 'Poslato: {0}' },
  'Označi datoteke ili mape na serveru kvačicama.': { en: 'Select files or folders on the server using the checkboxes.', de: 'Markiere Dateien oder Ordner auf dem Server mit den Häkchen.', fr: 'Coche des fichiers ou des dossiers sur le serveur avec les cases.', it: 'Seleziona file o cartelle sul server con le caselle.', bs: 'Označi datoteke ili mape na serveru kvačicama.', sr: 'Označi datoteke ili fascikle na serveru kvačicama.' },
  'Download greška ({0}): {1}': { en: 'Download error ({0}): {1}', de: 'Download-Fehler ({0}): {1}', fr: 'Erreur de téléchargement ({0}) : {1}', it: 'Errore di download ({0}): {1}', bs: 'Download greška ({0}): {1}', sr: 'Download greška ({0}): {1}' },
  'Preuzeta cijela mapa: {0}': { en: 'Whole folder downloaded: {0}', de: 'Ganzer Ordner heruntergeladen: {0}', fr: 'Dossier entier téléchargé : {0}', it: 'Intera cartella scaricata: {0}', bs: 'Preuzeta cijela mapa: {0}', sr: 'Preuzeta cela fascikla: {0}' },
  'Preuzeto: {0}': { en: 'Downloaded: {0}', de: 'Heruntergeladen: {0}', fr: 'Téléchargé : {0}', it: 'Scaricato: {0}', bs: 'Preuzeto: {0}', sr: 'Preuzeto: {0}' },
  'Diskovi…': { en: 'Drives…', de: 'Laufwerke…', fr: 'Disques…', it: 'Dischi…', bs: 'Diskovi…', sr: 'Diskovi…' },
  'Odaberi server u zaglavlju.': { en: 'Choose a server in the header.', de: 'Wähle einen Server in der Kopfzeile.', fr: 'Choisis un serveur dans l\u2019en-tête.', it: 'Scegli un server nell\u2019intestazione.', bs: 'Odaberi server u zaglavlju.', sr: 'Odaberi server u zaglavlju.' },
  'disk': { en: 'disk', de: 'Laufwerk', fr: 'disque', it: 'disco', bs: 'disk', sr: 'disk' },
  'Prazno.': { en: 'Empty.', de: 'Leer.', fr: 'Vide.', it: 'Vuoto.', bs: 'Prazno.', sr: 'Prazno.' },
  'Otvori': { en: 'Open', de: 'Öffnen', fr: 'Ouvrir', it: 'Apri', bs: 'Otvori', sr: 'Otvori' },
  'Preuzmi…': { en: 'Download…', de: 'Herunterladen…', fr: 'Télécharger…', it: 'Scarica…', bs: 'Preuzmi…', sr: 'Preuzmi…' },
  'Pošalji na server': { en: 'Send to the server', de: 'An den Server senden', fr: 'Envoyer vers le serveur', it: 'Invia al server', bs: 'Pošalji na server', sr: 'Pošalji na server' },
  '⬆ Slanje': { en: '⬆ Uploading', de: '⬆ Hochladen', fr: '⬆ Envoi', it: '⬆ Invio', bs: '⬆ Slanje', sr: '⬆ Slanje' },
  '⬇ Preuzimanje': { en: '⬇ Downloading', de: '⬇ Herunterladen', fr: '⬇ Téléchargement', it: '⬇ Download', bs: '⬇ Preuzimanje', sr: '⬇ Preuzimanje' },
  'Pošalji označene lokalne datoteke na server': { en: 'Send the selected local files to the server', de: 'Ausgewählte lokale Dateien an den Server senden', fr: 'Envoie les fichiers locaux sélectionnés vers le serveur', it: 'Invia i file locali selezionati al server', bs: 'Pošalji označene lokalne datoteke na server', sr: 'Pošalji označene lokalne datoteke na server' },
  'Preuzmi označene datoteke s servera': { en: 'Download the selected files from the server', de: 'Ausgewählte Dateien vom Server herunterladen', fr: 'Télécharge les fichiers sélectionnés depuis le serveur', it: 'Scarica i file selezionati dal server', bs: 'Preuzmi označene datoteke s servera', sr: 'Preuzmi označene datoteke sa servera' },
  'Veza nije uspjela: {0}': { en: 'Connection failed: {0}', de: 'Verbindung fehlgeschlagen: {0}', fr: 'Connexion échouée : {0}', it: 'Connessione non riuscita: {0}', bs: 'Veza nije uspjela: {0}', sr: 'Konekcija nije uspela: {0}' },
  '⟳ Pokušaj ponovo': { en: '⟳ Try again', de: '⟳ Erneut versuchen', fr: '⟳ Réessayer', it: '⟳ Riprova', bs: '⟳ Pokušaj ponovo', sr: '⟳ Pokušaj ponovo' },
  'Odaberi server u izborniku gore.': { en: 'Choose a server in the menu above.', de: 'Wähle einen Server im Menü oben.', fr: 'Choisis un serveur dans le menu ci-dessus.', it: 'Scegli un server nel menu sopra.', bs: 'Odaberi server u izborniku gore.', sr: 'Odaberi server u meniju gore.' },
  'Pošalji': { en: 'Send', de: 'Senden', fr: 'Envoyer', it: 'Invia', bs: 'Pošalji', sr: 'Pošalji' },
  'Preuzmi': { en: 'Download', de: 'Herunterladen', fr: 'Télécharger', it: 'Scarica', bs: 'Preuzmi', sr: 'Preuzmi' },
  /* general — gaps in bs/sr + en/de/fr/it */
  'Nova naredba': { en: 'New command', de: 'Neuer Befehl', fr: 'Nouvelle commande', it: 'Nuovo comando', bs: 'Nova komanda', sr: 'Nova komanda' },
  'Jezik': { en: 'Language', de: 'Sprache', fr: 'Langue', it: 'Lingua', bs: 'Jezik', sr: 'Jezik' },
  'About': { en: 'About', de: 'Über', fr: 'À propos', it: 'Info', bs: 'About', sr: 'About' },
  'Ready': { en: 'Ready', de: 'Bereit', fr: 'Prêt', it: 'Pronto', bs: 'Ready', sr: 'Spreman' },
  'Otvori terminal': { en: 'Open terminal', de: 'Terminal öffnen', fr: 'Ouvrir le terminal', it: 'Apri terminale', bs: 'Otvori terminal', sr: 'Otvori terminal' },
  'Otvori SFTP': { en: 'Open SFTP', de: 'SFTP öffnen', fr: 'Ouvrir le SFTP', it: 'Apri SFTP', bs: 'Otvori SFTP', sr: 'Otvori SFTP' },
  'Uredi': { en: 'Edit', de: 'Bearbeiten', fr: 'Modifier', it: 'Modifica', bs: 'Uredi', sr: 'Izmeni' },
  '{0} GB slobodno': { en: '{0} GB free', de: '{0} GB frei', fr: '{0} Go libres', it: '{0} GB liberi', bs: '{0} GB slobodno', sr: '{0} GB slobodno' },
  '⌨ Otvori terminal': { en: '⌨ Open terminal', de: '⌨ Terminal öffnen', fr: '⌨ Ouvrir le terminal', it: '⌨ Apri terminale', bs: '⌨ Otvori terminal', sr: '⌨ Otvori terminal' },
  '▤ Otvori SFTP': { en: '▤ Open SFTP', de: '▤ SFTP öffnen', fr: '▤ Ouvrir le SFTP', it: '▤ Apri SFTP', bs: '▤ Otvori SFTP', sr: '▤ Otvori SFTP' },
  '✎ Uredi': { en: '✎ Edit', de: '✎ Bearbeiten', fr: '✎ Modifier', it: '✎ Modifica', bs: '✎ Uredi', sr: '✎ Izmeni' },
  '▶ Pokreni': { en: '▶ Run', de: '▶ Ausführen', fr: '▶ Exécuter', it: '▶ Esegui', bs: '▶ Pokreni', sr: '▶ Pokreni' },
  'Tema': { en: 'Theme', de: 'Design', fr: 'Thème', it: 'Tema', bs: 'Tema', sr: 'Tema' },
  'Sigurnosna kopija i migracija': { en: 'Backup & migration', de: 'Backup & Migration', fr: 'Sauvegarde et migration', it: 'Backup e migrazione', bs: 'Sigurnosna kopija i migracija', sr: 'Rezervna kopija i migracija' },
  'Lozinka mora imati barem 4 znaka.': { en: 'The password must be at least 4 characters.', de: 'Das Passwort muss mindestens 4 Zeichen lang sein.', fr: 'Le mot de passe doit contenir au moins 4 caractères.', it: 'La password deve avere almeno 4 caratteri.', bs: 'Lozinka mora imati barem 4 znaka.', sr: 'Lozinka mora imati najmanje 4 znaka.' },
  'Export nije uspio.': { en: 'Export failed.', de: 'Export fehlgeschlagen.', fr: 'Échec de l\u2019export.', it: 'Esportazione non riuscita.', bs: 'Export nije uspio.', sr: 'Export nije uspeo.' },
  'Lozinka backup datoteke:': { en: 'Backup file password:', de: 'Passwort der Backup-Datei:', fr: 'Mot de passe du fichier de sauvegarde :', it: 'Password del file di backup:', bs: 'Lozinka backup datoteke:', sr: 'Lozinka backup datoteke:' },
  'Uvozim backup…': { en: 'Importing backup…', de: 'Backup wird importiert…', fr: 'Import de la sauvegarde…', it: 'Importazione backup…', bs: 'Uvozim backup…', sr: 'Uvozim backup…' },
  'Import nije uspio.': { en: 'Import failed.', de: 'Import fehlgeschlagen.', fr: 'Échec de l\u2019import.', it: 'Importazione non riuscita.', bs: 'Import nije uspio.', sr: 'Import nije uspeo.' },
  'Nema rezultata za "{0}".': { en: 'No results for "{0}".', de: 'Keine Ergebnisse für "{0}".', fr: 'Aucun résultat pour « {0} ».', it: 'Nessun risultato per "{0}".', bs: 'Nema rezultata za "{0}".', sr: 'Nema rezultata za "{0}".' },
  'Otvori tab': { en: 'Open tab', de: 'Tab öffnen', fr: 'Ouvrir l\u2019onglet', it: 'Apri scheda', bs: 'Otvori tab', sr: 'Otvori tab' },
  'Odvoji SFTP preglednik': { en: 'Detach SFTP browser', de: 'SFTP-Browser lösen', fr: 'Détacher l\u2019explorateur SFTP', it: 'Scollega browser SFTP', bs: 'Odvoji SFTP preglednik', sr: 'Odvoji SFTP preglednik' },
  'Odvoji preglednik': { en: 'Detach browser', de: 'Browser lösen', fr: 'Détacher l\u2019explorateur', it: 'Scollega browser', bs: 'Odvoji preglednik', sr: 'Odvoji preglednik' },
  'Kopiraj': { en: 'Copy', de: 'Kopieren', fr: 'Copier', it: 'Copia', bs: 'Kopiraj', sr: 'Kopiraj' },
  'Zatvori tab': { en: 'Close tab', de: 'Tab schließen', fr: 'Fermer l\u2019onglet', it: 'Chiudi scheda', bs: 'Zatvori tab', sr: 'Zatvori tab' },
  'Zatvori (Ctrl+W)': { en: 'Close (Ctrl+W)', de: 'Schließen (Ctrl+W)', fr: 'Fermer (Ctrl+W)', it: 'Chiudi (Ctrl+W)', bs: 'Zatvori (Ctrl+W)', sr: 'Zatvori (Ctrl+W)' },
  'Nema otvorenih veza.': { en: 'No open connections.', de: 'Keine offenen Verbindungen.', fr: 'Aucune connexion ouverte.', it: 'Nessuna connessione aperta.', bs: 'Nema otvorenih konekcija.', sr: 'Nema otvorenih konekcija.' },
  'SFTP preglednik': { en: 'SFTP browser', de: 'SFTP-Browser', fr: 'Explorateur SFTP', it: 'Browser SFTP', bs: 'SFTP preglednik', sr: 'SFTP preglednik' },
  'Nema veza — spoji se na server.': { en: 'No connections — connect to a server first.', de: 'Keine Verbindungen — verbinde dich zuerst mit einem Server.', fr: 'Aucune connexion — connecte-toi d\u2019abord à un serveur.', it: 'Nessuna connessione — connettiti prima a un server.', bs: 'Nema konekcija — spoji se na server.', sr: 'Nema konekcija — spoji se na server.' },
  'Nijedna označena veza nije aktivna.': { en: 'None of the selected connections is active.', de: 'Keine der markierten Verbindungen ist aktiv.', fr: 'Aucune des connexions sélectionnées n\u2019est active.', it: 'Nessuna delle connessioni selezionate è attiva.', bs: 'Nijedna označena konekcija nije aktivna.', sr: 'Nijedna označena konekcija nije aktivna.' },
  'Datoteka je prazna.': { en: 'The file is empty.', de: 'Die Datei ist leer.', fr: 'Le fichier est vide.', it: 'Il file è vuoto.', bs: 'Datoteka je prazna.', sr: 'Datoteka je prazna.' },
  'Ključ učitan: {0}': { en: 'Key loaded: {0}', de: 'Schlüssel geladen: {0}', fr: 'Clé chargée : {0}', it: 'Chiave caricata: {0}', bs: 'Ključ učitan: {0}', sr: 'Ključ učitan: {0}' },
  'Ključ učitan: {0} (stariji PEM format, ssh2 ga podržava).': { en: 'Key loaded: {0} (older PEM format, supported by ssh2).', de: 'Schlüssel geladen: {0} (älteres PEM-Format, wird von ssh2 unterstützt).', fr: 'Clé chargée : {0} (ancien format PEM, pris en charge par ssh2).', it: 'Chiave caricata: {0} (vecchio formato PEM, supportato da ssh2).', bs: 'Ključ učitan: {0} (stariji PEM format, ssh2 ga podržava).', sr: 'Ključ učitan: {0} (stariji PEM format, ssh2 ga podržava).' },
  'Ovo je PuTTY .ppk format — Treba ti OpenSSH ključ (puttygen: Conversions → Export OpenSSH key).': { en: 'This is PuTTY .ppk format — you need an OpenSSH key (puttygen: Conversions → Export OpenSSH key).', de: 'Dies ist das PuTTY-.ppk-Format — du brauchst einen OpenSSH-Schlüssel (puttygen: Conversions → Export OpenSSH key).', fr: 'C\u2019est le format PuTTY .ppk — il te faut une clé OpenSSH (puttygen : Conversions → Export OpenSSH key).', it: 'Questo è il formato PuTTY .ppk — serve una chiave OpenSSH (puttygen: Conversions → Export OpenSSH key).', bs: 'Ovo je PuTTY .ppk format — Treba ti OpenSSH ključ (puttygen: Conversions → Export OpenSSH key).', sr: 'Ovo je PuTTY .ppk format — Treba ti OpenSSH ključ (puttygen: Conversions → Export OpenSSH key).' },
  'Sadržaj učitan ({0}), ali ne liči na OpenSSH ključ — provjeri datoteku.': { en: 'Content loaded ({0}), but it doesn\u2019t look like an OpenSSH key — check the file.', de: 'Inhalt geladen ({0}), sieht aber nicht nach einem OpenSSH-Schlüssel aus — prüfe die Datei.', fr: 'Contenu chargé ({0}), mais ne ressemble pas à une clé OpenSSH — vérifie le fichier.', it: 'Contenuto caricato ({0}), ma non sembra una chiave OpenSSH — controlla il file.', bs: 'Sadržaj učitan ({0}), ali ne liči na OpenSSH ključ — provjeri datoteku.', sr: 'Sadržaj učitan ({0}), ali ne liči na OpenSSH ključ — proveri datoteku.' },
  'Novi server': { en: 'New server', de: 'Neuer Server', fr: 'Nouveau serveur', it: 'Nuovo server', bs: 'Novi server', sr: 'Novi server' },
  'Preuzimanje — {0} / {1}': { en: 'Downloading — {0} / {1}', de: 'Herunterladen — {0} / {1}', fr: 'Téléchargement — {0} / {1}', it: 'Download — {0} / {1}', bs: 'Preuzimanje — {0} / {1}', sr: 'Preuzimanje — {0} / {1}' },
  'Preuzimanje završeno ✓': { en: 'Download complete ✓', de: 'Herunterladen abgeschlossen ✓', fr: 'Téléchargement terminé ✓', it: 'Download completato ✓', bs: 'Preuzimanje završeno ✓', sr: 'Preuzimanje završeno ✓' },
  'Imaš najnoviju verziju ({0}). ✓': { en: 'You have the latest version ({0}). ✓', de: 'Du hast die neueste Version ({0}). ✓', fr: 'Tu as la dernière version ({0}). ✓', it: 'Hai l\u2019ultima versione ({0}). ✓', bs: 'Imaš najnoviju verziju ({0}). ✓', sr: 'Imaš najnoviju verziju ({0}). ✓' },
  'Trenutna verzija: {0} → Nova: {1}': { en: 'Current version: {0} → New: {1}', de: 'Aktuelle Version: {0} → Neu: {1}', fr: 'Version actuelle : {0} → Nouvelle : {1}', it: 'Versione attuale: {0} → Nuova: {1}', bs: 'Trenutna verzija: {0} → Nova: {1}', sr: 'Trenutna verzija: {0} → Nova: {1}' },
  'Preuzimanje otvoreno u pregledniku.': { en: 'Download opened in the browser.', de: 'Download im Browser geöffnet.', fr: 'Téléchargement ouvert dans le navigateur.', it: 'Download aperto nel browser.', bs: 'Preuzimanje otvoreno u pregledniku.', sr: 'Preuzimanje otvoreno u pregledniku.' },
  'Preuzimanje — …': { en: 'Downloading — …', de: 'Herunterladen — …', fr: 'Téléchargement — …', it: 'Download — …', bs: 'Preuzimanje — …', sr: 'Preuzimanje — …' },
  'Pokrećem instalaciju — aplikacija će se zatvoriti…': { en: 'Starting installation — the app will close…', de: 'Installation wird gestartet — die App wird geschlossen…', fr: 'Lancement de l\u2019installation — l\u2019application va se fermer…', it: 'Avvio installazione — l\u2019app si chiuderà…', bs: 'Pokrećem instalaciju — aplikacija će se zatvoriti…', sr: 'Pokrećem instalaciju — aplikacija će se zatvoriti…' },
  'spajam se…': { en: 'connecting…', de: 'verbinde…', fr: 'connexion…', it: 'connessione…', bs: 'spajam se…', sr: 'povezujem se…' },
  'Auto-refresh interval': { en: 'Auto-refresh interval', de: 'Auto-Refresh-Intervall', fr: 'Intervalle d\u2019actualisation', it: 'Intervallo di aggiornamento', bs: 'Auto-refresh interval', sr: 'Interval auto-osvežavanja' },
};

/* existing keys per language */
const src = fs.readFileSync(FILE, 'utf8');
const keys = {};
const re = /(?:^|\n)\s{4}(en|de|fr|it|bs|sr): \{/g;
let m; const marks = [];
while ((m = re.exec(src))) marks.push({ lang: m[1], idx: m.index });
for (let i = 0; i < marks.length; i++) {
  const start = src.indexOf('{', marks[i].idx);
  const end = i < marks.length - 1 ? marks[i + 1].idx : src.length;
  const body = src.slice(start, end);
  const set = new Set();
  const kre = /(['"])((?:\\.|[^'\\\n])*)\1\s*:/g;
  let k;
  while ((k = kre.exec(body))) set.add(ev(k[1] + k[2] + k[1]));
  keys[marks[i].lang] = set;
}

/* insertion */
let added = 0;
let out = src;
for (const lang of LANGS) {
  const entries = Object.entries(TRANS).filter(([k, v]) => v[lang] != null && !keys[lang].has(k));
  if (!entries.length) { console.log(`[${lang}] ništa za dodati`); continue; }
  const block = entries.map(([k, v]) => `      ${JSON.stringify(k)}: ${JSON.stringify(v[lang])},`).join('\n');
  const marker = `\n    ${lang}: {`;
  if (pos < 0) { console.log(`[!] marker for ${lang} not found`); continue; }
  out = out.slice(0, pos + marker.length) + '\n' + block + out.slice(pos + marker.length);
  added += entries.length;
  console.log(`[${lang}] +${entries.length}`);
}
fs.writeFileSync(FILE, out);
console.log(added ? `[FILL] total added ${added}` : '[FILL] nothing to do');
