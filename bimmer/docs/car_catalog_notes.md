# Le catalogue de signaux de la voiture du propriétaire (X3 30e G01 LCI, iDrive 7)

Notes tirées des ~80 photos que le propriétaire a envoyées le 17 novembre 2026 : l'écran de catalogue de l'appli *Cluster Centre* / *Cluster Layouts* (eroobeeroo), qui liste les interfaces SOME/IP de SA voiture. Les photos retirent le préfixe `de.bmw.`. Le catalogue de `shared/catalog.js` ne garde que les interfaces `de.bmw.*`.

À lire avant de déclarer un nouveau signal dans un `app.json`.

## Règle d'or : présent au catalogue ≠ accepté à l'installation

Le gestionnaire d'applis de la voiture (« oapgen », `generateSomeipInterfaces`) refuse l'installation ENTIÈRE (« UPDATE_FAILED ; la version précédente est gardée ») si un signal déclaré ne correspond pas à son catalogue. Les notes `_optional` d'un `app.json` n'y changent rien, et le propriétaire ne peut pas lire la raison sur la voiture.

- Cas connu : ShakTheme 0.21.12 a déclaré `CarPlayManager.projectedGuidanceActive` avec « rs » (le catalogue dit « get notify »). Refusé quand même. Cause inconnue. Voir le CHANGELOG, entrée 0.21.13.
- Donc : on ne déclare que des noms vus acceptés par une vraie installation. La liste est `tools/car_accepted_signals.json`, vérifiée par `tools/test_declared_signals.js`.
- Sont aussi acceptés, car installés sur sa voiture : tout ce que déclarent *Cluster Layouts* 0.28.1 et *Cluster Centre* 0.9.0 (`eroobeeroo/apps/*/app.json`). Ils ont été ajoutés à la liste le 17 novembre 2026.
- Un nom seulement présent au catalogue (liste ci-dessous) ne se déclare qu'après un essai d'installation, seul, sur la voiture.

Drapeaux : « get notify » = `rs`, « notify » seul = `s` (le test accepte un `s` déclaré sur un `rs` accepté).

## Ce qui est déjà lu, et par quoi

| Signal | Rôle |
|---|---|
| `CDS.statusEngineSpeed2`, `statusEngineTemperature`, `Vehicle2.statusCarSpeed2` | régime, températures, vitesse |
| `CDS2` accélération longitudinale / latérale | boule des G |
| `FES` mode de conduite, couple | modes, couple |
| `KombiIF` autonomie électrique, répartition de puissance, message CC | autonomie, alertes |
| `TPMS` pression / température | pneus |
| `TrafficSignDisplayControl`, `FASuS` | limite de vitesse lue par la caméra, limite suivante, voyants d'assistance |
| `Efficiencytainment2.statusPowerRelativHybrid` (**17 nov. 2026**) | compteur de puissance d'origine du tableau de bord : propulsion % et récupération %, source de la barre bleue / verte du compte-tours hybride (voir ci-dessous) |
| `Efficiencytainment2.displayPowerDrive[2]` | part de puissance (échelle inconnue : 100 à 2 km/h), réglage `carPower`, désactivé par défaut. À retirer si `statusPowerRelativHybrid` est confirmé sur la voiture. |

### `statusPowerRelativHybrid`, à vérifier sur la voiture

Source : `eroobeeroo/apps/cluster_layouts/shared/data.js` lit `displayActualValuePowerRelativeDrivingElectric` et `displayActualValuePowerRelativeRecuperation` (`{pollMs: 2000}`). Le nom est déjà déclaré « rs » par les deux applis Cluster installées.

Ce qu'on ne sait pas : l'échelle sur la G01 (supposée 0 à 100 %), et si la voiture notifie une valeur qui ne change pas (d'où la relecture toutes les 2 s). Garde-fous dans le code (`shared/car_extras.js` `relPowerOf`, `shared/hud.js` `_relPower`) : un nombre au-dessus de 100 n'est jamais dessiné ; 255, 65535 et 0x7FFF sont ignorés ; la source ne compte qu'après une première valeur au-dessus de 0 ; une lecture de plus de 6 s est périmée. Sinon la barre retombe sur la part de puissance de la voiture puis sur l'estimation. Ordre : eDrive Live (kW réels) > compteur du tableau de bord > part `displayPowerDrive` > estimation.

Page 1 de l'onglet Signaux, ligne « Puissance : compteur du tableau de bord » : « propulsion N % · récup M % · barre K kW » (ou « pas utilisé » tant que la barre ne s'en sert pas). Une photo en accélération et une au lâcher donnent l'échelle.

## Noms vus au catalogue, jamais déclarés (essai d'installation nécessaire)

Intéressants, par ordre de valeur :

- **Boutons du volant** : `infotainment.controlelements.SteeringWheelPushButton` (pages « steering, yaw and engine starts » 3 et 6 : FAV, molette appui et pas, PTT, téléphone, recherche). Première lecture : on s'était trompé en disant qu'il n'y avait aucun signal de bouton du volant. Pistes : changer de thème, lancer le chrono 0-100. Les boutons peuvent aussi être pris par l'autoradio de la voiture : à essayer.
- **Angle du volant** : `ActualSteeringAngleDriver` (SteeringAngle, déjà déclaré par Cluster Layouts donc accepté) et le lacet (`CDS2.statusYawVelocityVehicle`, accepté aussi).
- **Vitesse régulateur** : `DisplayDataServer.functionalLibraryData` (accepté, déjà déclaré par Cluster Layouts), pour afficher la consigne sur le HUD.
- **Raison du démarrage du moteur thermique** : `Efficiencytainment.statusReasonPowerUpCombustionEngine`, `FES.statusEDriveEVSystemState`, `FES.statusFESDriveStrategy` (stratégie hybride).
- **Consommation instantanée** : `ResetLogic.currentConsumption` (accepté). **Température de la batterie** : `Efficiencytainment2.statusBatteryTemperature` (accepté, brut 76 pour ~26 °C sur X5 45e d'après un commentaire d'eroobeeroo).
- **Autonomie bonus / éco** : `DisplayEfficiencyTrainer`, `KombiIF.statusECORange(Won)`.
- **Clignotants** : famille `body.Light`. **Compteur de dérives M** : `MDrive.statusDriftTrackInfoMeta`.
- **Caméra de recul** : rien de précis ; les boutons `UserInteractionParkmenu.controlCameraCleaningButton` et les messages `ParkmenuInstrumentCluster` (`displayMessage`, `popUpRequest`) existent.

- **Position GPS** (le propriétaire l'a lue au catalogue, 17 nov. 2026, de la forme `infotainment.GPSData`, deux derniers morceaux du nom comme la page Signaux les écrit ; le nom complet `de.bmw.infotainment.GPSData` est déduit de `KombiIF`, **accepté et disponible** : photo de ShakGPS du 19 nov. 2026, plus de 2 000 messages, un par seconde. Membres : `statusGPSLatitudeCAN` et `statusGPSLongitudeCAN` en **millisecondes d'arc autour de 2^31** (2323529010 / 2156016555 = 48,90 N, 2,37 E) ; `statusHeadingGPSCAN` (cap), `statusHeightGPSCAN` (altitude en m autour de 32768), `statusQualityPositionGPSCAN`, `speedGPSCAN` (autour de 32768, unité pas encore connue)) : `GPSPositionCAN` (latitude et longitude, lisible et notifié), `GPSPositionExtendedCAN` (cap, altitude, qualité, vitesse). `entrypoint2.EntryPoint2.locationData` est lisible aussi, moins détaillé (préfixe du nom complet inconnu). Essai : appli `shakgps` (`shared/probe_sets.js`), et **ShakRadar** (`apps/shakradar`), qui s'en sert pour l'alerte de zone de danger (échelle trouvée par `shared/gps_pos.js`). Si la voiture la refuse, c'est le nom complet qui est faux. Les unités et les noms des membres sont à lire sur l'écran de l'essai avant d'écrire quoi que ce soit pour les radars.

Toujours introuvable : le titre du morceau CarPlay (`CarLifeMp` ne sert que Baidu).

## Marche à suivre pour un nouveau signal

1. Chercher le nom ici et dans `tools/car_accepted_signals.json`. S'il est accepté, déclarer avec les mêmes drapeaux, ajouter une sonde (`shared/probes.js`), la lire dans `shared/hud.js`.
2. Sinon, une version d'essai portant ce seul signal, installée seule sur la voiture ; si elle s'installe, l'ajouter à `car_accepted_signals.json`.
3. Ajouter à une interface déjà déclarée (Efficiencytainment2, CDS, CDS2) ne coûte aucune nouvelle ouverture au démarrage ; une nouvelle interface rallonge le démarrage (les ouvertures natives se font l'une après l'autre).

## Relevé du 19 novembre 2026 (photos de l'onglet Signaux de ShakTheme 0.21.37, pages 3 à 13)

Noms lus sur la voiture du propriétaire (X3 30e G01 LCI). « gn » = get notify, « n » = notify seul. Aucun n'est déclaré tant qu'il n'est pas dans `tools/car_accepted_signals.json`.

- **Boutons (p. 3)** : `drivinglight.LightswitchOperation.lightswitchButtonAvailability` (gn), `steeringwheelcomfort.SteeringWheelClimate.heatingState` (gn), `driverassistanceapplications.DisplayDriverAssistanceLateralCoordinated.displaySteeringWheel` (n), `dass.HMIControlAD.statusDataPrivacyButton` (n), `userinteraction.UserInteractionParkmenu.controlCameraCleaningButton` / `pdcSoundButton` (gn), `SettingsDriverAssistanceFunctions.settingAdSteeringWheelLED[Brightness]` (n). Pas de touche BC, pas de bouton multifonction.
- **ShakVolant** : `SteeringWheelPushButton` est disponible : `statusAudioVolumeButton`, `statusPTTButton1`, `statusRotaryPress` (valeur de départ SIGNAL_UNGUELTIG), `statusRotarySteps`, `statusSearchSwitch1`, `statusTelephoneButton` (un message de départ chacun) ; `operationSteerWheelFAV` et `operationSteerWheelFC` : rien reçu. La touche BC (commodo) n'y fait rien bouger.
- **Média (p. 4)** : `carlifemp.CarLifeMp.currentItemMetadata` (source, song, artist, album, albumArt, duration…, gn), `carplay.CarPlayManager.projectedGuidanceMetadataAvailable` (gn), `dynamicmediaplayer.DynamicMediaPlayer.autoPlayStatus` / `connectionState` / `currentAudioFocus` (gn).
- **Panneaux (p. 5)** : `TrafficSignDisplayControl.displaySpeedLimitAndNoPassingRestriction` (displaySpeedLimit, displaySpeedLimitUnit, displaySpeedLimitWarning…), `displayForesight` (dispSpeedForesight, dispSpeedForesightDistance…), `displayDriverAssistanceLongitudinal`, `displayColorLabel` : tous **notify seul** (pas de lecture à la demande : rien tant que la voiture n'annonce pas un changement). `SettingsDriverAssistanceFunctions.displayStatusSpeedLimitAssist[Foresight|ForesightStreet|Mode]` (n).
- **Puissance (p. 6)** : `Efficiencytainment2.displayPowerDrive` / `displayPowerDrive2` (n), `infotainment.ConsumptionHistory[2|3].counterDistanceEDrive` (gn), `chassis.SteeringAngle.ActualSteeringAngleDriver` (n).
- **Radars et dangers (p. 8)** : `navigation.ADAS.navGraphSpeedHazardEvent`, `navGraphExtendedSpeed2`, `navGraphMapData` (événements de la carte de navigation), `displaydata.DisplayDataServer2.functionalLibraryData` (speedWarning, n).
- **GPS (p. 10-11)** : `infotainment.GPSData.*` (déjà lu), `navigation.ADAS.navigationGPS1` / `navigationGPS2`, `navigation.PositioningCAN.statusGpsPosition[Extension]`, `gpsRawData`.
- **Régime sous d'autres noms (p. 13)** : `vehicle.CDS.statusEngineSpeed2` (gn, déjà lu : vaut 0 moteur thermique arrêté), **`displaydataserver.DisplayDataServer.functionalLibraryData`** (membre `rpm`, gn : candidat pour le compte-tours du HUD), `drivingexcitement.FES.displaySportPowertrain` (displaySportRpmEmachine, n : régime de la machine électrique), `FES.statusSwitchDriveDynamicSport2` (displaySportRpmEMachineMax, gn), `FES.statusActualValueTorque2` (gn).

### Suite du relevé du 19 novembre 2026 (ShakTheme 0.21.39 à 0.21.41, pages 14 à 18)

- **Touche BC et commodo (p. 14-15)** : `de.bmw.body.Light` `IndicatorSteeringColumn` (operationColumnStalks, n) et `IndicatorSteeringColumnComplete` (+ statusPushButtonMainBeamAssistant, n) : **acceptés et vivants** (ShakManette) : `operationColumnStalks` vaut 64 pendant l'appui sur BC, 0 au relâcher. Lu par ShakTheme depuis la 0.21.41 (`shared/bc_button.js`). `body.Wiper.wiperSteeringColumn` (n). `KombiIF.operationBordcomputer` et `kombiSelection` : ni get ni notify. `KombiIF.statusBordcomputerAverage`, `statusBordcomputerElectricData`, `statusBordcomputerStatus2`, `statusBordcomputerTravelData`, `statusBordcomputerTravelStart`, `statusConsumptionAverageElectricVehicle`, `statusKombiSelection`, `statusKombiSelectionAvailability` (gn), `vehicle.Vehicle.statusTripInformationElectricHybrid` (gn) : pas encore essayés.
- **Panneaux, suite (p. 16)** : seulement des réglages (`SettingsDriverAssistanceFunctions.settingSpeedLimitAssist`, `settingSpeedLimitInfoPresentation`, `settingSpeedLimitInfoWarning`…, n). Pas de valeur de limitation.
- **`navigation.ADAS` (p. 17-18)** : `currentSegmentNavGraph2` (limitSpeedNavGraph2…), `navGraph` (limitSpeedNavGraph), `navGraphExtendedSpeed[2]` (trafficSignSpeedVariable, limitSpeedConditional), `navGraphMapData`, `matchNavigationGraph`… : toutes en « getter#0, setter#N », sans notifier. C'est l'écran central qui envoie l'horizon de la carte à la voiture : une appli ne peut ni le lire ni y être abonnée. **La limitation que le tableau de bord d'origine affiche vient de là, et n'est pas lisible.** `TrafficSignDisplayControl` « ne répond pas » (service non proposé). Conclusion : la limitation passe par ShakLimites (carte OpenStreetMap).
