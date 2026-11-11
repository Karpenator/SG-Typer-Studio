# Firefly avec un compte Photoshop personnel

Recherche du 10 novembre 2026. Objectif : proposer le remplissage Adobe dans TypeR
Studio sans lancer Photoshop et en utilisant les droits du compte de l'utilisateur.

## Conclusion et niveau de preuve

La piste à prototyper est un connecteur vers **Firefly web**, avec une session Adobe
personnelle. Le code JavaScript public du site expose actuellement le véritable modèle
**Firefly Fill & Expand**, son envoi d'image et de masque, sa requête de génération et
la récupération du résultat. Il ne s'agit pas seulement des modèles partenaires de
Firefly, ni de l'API commerciale Firefly Services.

Un connecteur expérimental est maintenant implémenté dans l'application de bureau :
`desktop/src/firefly.js`, `desktop/src/firefly-client.js` et `web/generative.js`.
La fenêtre Adobe charge réellement sa bibliothèque IMS. L'utilisateur a ensuite
indiqué que sa connexion semblait avoir abouti ; nous n'avons pas inspecté sa session.
Les tests locaux vérifient le protocole avec un transport simulé, le masque, les
dimensions, l'insertion sur un calque et l'annulation dans l'éditeur réel.

**Aucune génération authentifiée n'a été exécutée par l'agent avec le compte de l'utilisateur.**
La session de test était déconnectée ; la demande sécurisée d'un jeton pour un essai
réel a expiré sans réponse. Les droits réels du compte, l'acceptation des appels
et le renouvellement d'une session connectée restent à valider auprès d'Adobe.
L'utilisateur a ensuite signalé un essai Image 5 refusé par le connecteur avec
`Unexpected Adobe response URL.` Le correctif décrit ci-dessous est validé
localement ; son essai authentifié reste à faire.

Adobe explique que les crédits des abonnements Creative Cloud, dont Photoshop,
peuvent servir dans Firefly web. Cela ne signifie pas que toutes les fonctions sont
illimitées, ni que l'abonnement donne des identifiants Firefly Services :

- [Crédits et utilisation entre applications](https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html)
- [Remplissage dans Firefly web](https://helpx.adobe.com/firefly/web/work-with-images/edit-images/generative-fill.html)
- [Conditions d'accès à Photoshop API / Firefly Services](https://developer.adobe.com/firefly-services/docs/photoshop/getting-started/)

## Protocole retrouvé dans le client public

### Dégradation des tons lors de la réinsertion

Après confirmation que les modèles répondent, l'utilisateur a signalé une zone
grise et une mauvaise conservation du dessin. Un défaut local a été reproduit
dans `matchLevels` : pour des alentours uniformément blancs, une sortie parfaite
à 255 devenait 85 ; un gris inchangé à 128 devenait 77. La table de correspondance
était calculée même pour les niveaux absents de l'histogramme, puis lissée avec
ces valeurs sans information. Les détails présents seulement dans la sélection
pouvaient aussi être aplatis. Ce défaut intervient après la réponse Adobe.

La correction utilise uniquement les niveaux réellement observés comme points
de correspondance. Elle interpole entre eux et prolonge leur décalage aux
extrémités, conservant ainsi les détails hors de la gamme observée autour du
masque. Les tests vérifient l'identité sur blanc, gris, noir/blanc et dégradé,
la conservation des détails dans le masque et la correction d'un décalage réel
de luminosité. Un test Electron vérifie une réinsertion sans aucun pixel modifié
sur un dessin synthétique noir et gris sur papier blanc, avec l'harmonisation
des tons activée et désactivée.

Le masque GPT correspond au contrat Adobe (alpha transparent dans la zone à
régénérer), et les paramètres du modèle ne sont pas changés pour ce correctif.
La fidélité de la reconstruction du dessin caché par les lettres reste distincte
de ce défaut de traitement et n'a pas été validée par une génération authentifiée.

### Compteur de crédits

Le chunk public Adobe `82040` définit un GET authentifié vers
`https://firefly.adobe.io/v1/credits/balance` avec la clé de client
`clio-playground-web`. Le connecteur utilise cette adresse fixe et retourne
uniquement le quota agrégé `total.quota.total`, le solde
`total.quota.available` et la date `total.availableUntil`, normalisée si valide.
Le contrat de ces champs a été recoupé avec le client source
[adobeFireflyAccount.ts](https://github.com/cheaper-inference/OmniRoute/blob/main/open-sse/services/adobeFireflyAccount.ts) ;
la réponse du compte de l'utilisateur n'a pas été lue pendant cette validation.
Le parseur local n'en reprend pas le comportement de remplacement d'un zéro :
un solde explicitement nul reste nul et un schéma inconnu produit « indisponible ».

L'accès IPC est réservé à l'éditeur, avec un délai maximal de 15 secondes, une
réponse limitée à 1 Mio et les redirections refusées. Une réponse arrivée après
déconnexion ou changement de session est écartée. Aucun jeton ni profil brut ne
transite vers l'éditeur. Le solde n'est pas persisté dans les réglages.

La carte Adobe des réglages affiche le solde, une jauge, la date de remise à zéro
et un bouton d'actualisation. La lecture est renouvelée à la connexion, à
l'ouverture des réglages si le cache a plus d'une minute, et après une tentative
de génération. Aucun coût n'est soustrait localement : Adobe fait autorité, y
compris si un remboursement après échec n'est pas instantané. La
[FAQ Adobe](https://helpx.adobe.com/creative-cloud/apps/generative-ai/generative-credits-faq.html)
confirme le solde partagé entre applications et la date mensuelle dans le compte.

Les tests de contrat et d'interface utilisent un solde synthétique de 188/250
avec la date de la capture utilisateur. Ce ne sont pas des valeurs enregistrées
dans l'application ni une validation authentifiée du solde actuel.

Point de départ : <https://firefly.adobe.com/upload/inpaint>. Le nouvel éditeur est
aussi accessible à <https://firefly.adobe.com/generate/image?view=edit>.

Les noms, domaines et structures ci-dessous sont des observations du code téléchargé,
pas une API publique promise stable par Adobe.

### Modèles partenaires et catalogue du 10 novembre 2026

#### Correctif du contexte de session des partenaires

L'utilisateur a signalé `HTTP 408 (timeout_error)` pour les partenaires dans
TypeR, puis confirmé que GPT Image 2.5 Flare fonctionne avec son compte sur le
site Firefly. Ce constat oriente vers le connecteur sans prouver à lui seul la
cause exacte de chaque 408.

La comparaison avec le client Adobe a révélé deux en-têtes de génération absents :
`x-arp-session-id`, lu depuis la session Adobe initialisée par le site, et `x-nonce`,
le SHA-256 de l'identifiant utilisateur, d'un tiret et des 256 premiers caractères
de la consigne. Le bundle commun, modules `8930`, `45454` et `897148`, définit ce
calcul et ces en-têtes. Le module `574827` du
[bundle principal Adobe](https://firefly.adobe.com/spl-static/js/bundle.9cc6edc3b1340774.min.js)
fournit l'observable de session utilisé par le site. Empreinte SHA-256 du fichier
consulté : `e6c7a4c8022b6414606e81315e054af4642556a9a63a0cac786a0a37bc781694`.

`firefly-session-context.js` lit cet observable et le profil via Adobe IMS dans
la fenêtre Adobe isolée, à chaque demande. Si Rspack n'expose pas son chargeur,
un callback de module vide en obtient la référence ; aucun module Adobe n'est
remplacé. Aucun jeton n'est fabriqué et aucun mécanisme de vérification n'est
modifié. Les champs restent dans le processus principal, ne sont pas enregistrés
dans les réglages et ne sont envoyés qu'à l'endpoint de génération, jamais au
téléchargement des images. Une indisponibilité du module interne est tolérée.

Les erreurs HTTP précisent maintenant l'étape (`upload`, `generation`, `status`
ou `download`) et la durée de l'appel. Elles n'exposent ni le corps d'erreur brut,
ni les identifiants ou les paramètres d'URL. Aucun 408 ne relance automatiquement
une génération, et le délai local n'a pas été augmenté sans preuve.

Validation : 33 tests locaux réussis, dont lecture/renouvellement du contexte,
libération de l'observateur, séparation des en-têtes et erreurs 408 aux quatre
étapes. Les tests Electron d'insertion, sélection et annulation passent également.
L'essai de lecture dans une fenêtre Adobe réelle déconnectée renvoie des champs
absents ; il ne valide donc pas une session authentifiée ni la résolution du 408.

Deux témoignages distincts sur le forum Adobe décrivent le même 408 sur le site,
les 17 août et 6 novembre 2026, sans résolution confirmée par leurs auteurs :
[compte d'essai](https://community.adobe.com/bug-reports-403/partner-models-are-not-generating-any-content-with-my-new-firefly-pro-plus-trial-account-1637370)
et [compte payant](https://community.adobe.com/bug-reports-403/all-partner-models-fail-with-408-system-under-load-for-6-weeks-on-a-paid-plan-support-confirmed-bug-still-not-fixed-1654621).
Ils établissent que le code d'erreur n'est pas spécifique à TypeR ; ils ne
démontrent pas un problème de droits pour le compte de cet utilisateur.

#### Contrat des requêtes

Le [catalogue Adobe avec schémas](https://gateway.ff.adobe.io/v2/models/discovery?includeFirstParty=true&resolveSchema=true)
a été récupéré sans session, avec l'en-tête public `x-api-key: clio-playground-web`.
L'extrait factuel et l'empreinte de la réponse complète sont conservés dans
`firefly-partner-catalogue.json`. Les correspondances utilisées sont :

| Nom affiché | modelId | modelVersion |
| --- | --- | --- |
| GPT Image 2 | gpt-image | 2 |
| GPT Image 2.5 Flare | gpt-image | gpt-image-2.5-flare |
| GPT Image 2.5 Sunburst | gpt-image | gpt-image-2.5-prism |
| GPT Image 2.6 Flare | gpt-image | gpt-image-2.6-star-swirl |
| GPT Image 2.6 Sunburst | gpt-image | gpt-image-2.6-aurora |
| Gemini Nano Banana 2.1 | gemini-flash | nano-banana-2026-09 |
| Gemini 3.1 (Nano Banana 2) | gemini-flash | nano-banana-3 |
| Gemini 3.0 (Nano Banana Pro) | gemini-flash | nano-banana-2 |

Le client public configure `https://firefly-3p.ff.adobe.io` pour l'envoi des images
à `/v2/storage/image`, puis la génération à `/v2/3p-images/generate-async`.
Les requêtes comportent `n: 1`, `output.storeInputs: false` et
`generationMetadata.module: "image-editing"`.

GPT reçoit une référence `source` et, si présent, un masque `mask` de même taille :
alpha nul dans la sélection à régénérer, alpha opaque ailleurs. Ses dimensions de
sortie sont alignées sur 16 avec un ratio maximal de 3:1. Gemini reçoit une référence
`general`, une résolution 1K ou 2K et le ratio autorisé le plus proche, sans masque.
Dans les deux cas, TypeR aligne le résultat puis limite l'insertion à la sélection.

Firefly Image 4 n'accepte ici qu'une référence de style (`style_reference`) ;
HUMAIN Image 1 déclare l'entrée image non prise en charge (`not_supported`).
Ils ne sont donc pas ajoutés au remplissage. Le catalogue ne prouve pas les droits
du compte de l'utilisateur et aucun repli automatique entre modèles n'est prévu.

### Correction des liens de suivi Image 5

Le connecteur refusait les serveurs BKS utilisés pour suivre certaines générations,
ce qui pouvait produire l'erreur signalée. La liste autorise désormais exclusivement
`bks.adobe.io`, `bks-epo8552.adobe.io`, `bks-epo8512.adobe.io` et
`bks-epv8516.adobe.io`, en HTTPS, pour les chemins de résultat ou d'annulation
`/jobs/result`, `/jobs/cancel` et leurs variantes préfixées par une version.
Ces domaines sont également signalés dans une
[discussion du forum Adobe sur les points de terminaison](https://community.adobe.com/questions-624/many-missing-urls-in-kb-article-about-network-endpoints-1552547).
Un appel sans authentification à `/v2/jobs/result` sur `bks-epo8552.adobe.io`
a reçu une réponse HTTP 405 ; cela confirme une réponse du serveur, pas une génération réussie.

Les erreurs d'adresse affichent maintenant seulement le nom d'hôte refusé, sans
paramètres ni jetons, pour diagnostiquer un éventuel autre serveur. Les tests
simulent le lien `x-override-status-link`, vérifient le refus des hôtes ressemblants
et des chemins non prévus, puis le téléchargement du résultat sans jeton Adobe.
Les 25 tests du connecteur et les tests Electron de sélection des huit partenaires,
de masque, d'insertion et d'annulation ont réussi avec un transport simulé.

Une seconde capture utilisateur a identifié précisément l'hôte refusé
`firefly-epo855254.adobe.io`. Il rejoint la même liste restreinte aux chemins de
suivi et d'annulation. Un GET sans identifiants sur `/jobs/result/test` y répond
HTTP 403 `ErrMissingAPIKey` (les chemins `/v2/jobs/result` et
`/v1/images/generate-async` répondent 404). Ce constat ne valide pas une génération,
mais confirme que le chemin de suivi existe sur cet hôte. Un test supplémentaire
reproduit ce serveur dans un lien de résultat et dans `x-override-status-link`,
avec un lien d'annulation, et conserve le refus des hôtes ressemblants, des ports
non prévus et des chemins hors suivi. Aucun domaine générique supplémentaire
n'est autorisé.

À la demande de l'utilisateur, cette liste de déploiements individuels a ensuite
été remplacée par une règle de famille : `bks.adobe.io`, `firefly.adobe.io` et
leurs variantes `-ep` suivies de lettres facultatives puis d'un numéro de
déploiement, directement sous `adobe.io`. Par exemple, `firefly-epo855254`,
`firefly-epv987654321` et `bks-epo123456789` satisfont la règle. Les deux derniers
sont des exemples synthétiques de test, pas des serveurs vérifiés en ligne.
Les restrictions HTTPS, port 443, absence d'identifiants dans l'URL et chemins
de suivi restent en place, ainsi que le refus des redirections HTTP. Les tests
vérifient plusieurs numéros inconnus à l'avance, les liens dans la réponse et
dans l'en-tête, les domaines ressemblants et les chemins hors suivi.

### Modèle Fill & Expand

- Identifiant : `adobe:firefly:colligo:di:me:generate-fill`.
- Nom affiché : `Firefly Fill & Expand`.
- Configuration : `endpoint: multi-edit`, version `generate-fill-v1`.
- Le catalogue le marque comme Adobe et non premium.
- Contraintes déclarées : 4 mégapixels maximum, dimensions alignées sur 16 pixels,
  image source avec transparence aplatie.

### Firefly Image 5 : protocole distinct

Ajouté à la demande de l'utilisateur, en conservant Fill & Expand comme autre choix.
L'analyse statique du bundle public `bundle.5f9a610ade251531.min.js` retrouve :

- Le catalogue `adobe:firefly:colligo:image5`, `endpoint: v5`, `isPremium: true`,
  `supportsInstructEditMode: true`, une image de référence maximum.
- Le module `182252` configure le client sur `https://image-v5.ff.adobe.io` avant
  de préparer la requête. Le module `191778` envoie donc aussi l'image de référence
  sur ce domaine, à `/v2/storage/image`, et récupère `images[0].id`.
- Le module `983853`, fonction exportée `f$`, construit le corps avec
  `modelVersion: "image5"`, `referenceBlobs: [{id, usage: "general"}]`, `prompt`,
  `n`, `seeds`, `output.storeInputs` et `generationMetadata.module: "text2image"`.
  Le mode de retouche n'envoie ni masque, ni dimensions fixes de sortie : le ratio
  vient de la référence. `resolutionLevel` vaut `1MP` pour 1K et `4MP` pour 2K.
- Le module `873542`, export `bi`, appelle `POST /v1/images/generate-async`.
  Le statut utilise les liens `links.result.href`, parfois relatifs, et l'éventuel
  en-tête `x-override-status-link`. `x-task-status: COMPLETED` indique le résultat
  final. L'annulation utilise `PUT /jobs/cancel/{job_urn_or_id}`.
- Le téléchargement utilise `outputs[].image.presignedUrl`, sans jeton Adobe.

Le connecteur sélectionne explicitement Image 5 et ne remplace jamais ce modèle
par Fill & Expand après une erreur. TypeR conserve le masque local pour limiter
l'insertion au tracé sélectionné, et active l'alignement du résultat comme pour
les autres modèles de retouche par consigne. Un prompt vide devient la consigne
habituelle de nettoyage du lettrage de TypeR. Les PNG, JPEG et WebP sont acceptés
en sortie, même si leurs dimensions diffèrent de la référence.

Les tests vérifient ces branches avec un transport simulé, notamment le modèle
explicitement envoyé, les liens de statut, l'annulation PUT, l'absence de repli,
le décodage d'un JPEG de taille différente et les pixels inchangés hors sélection.
**Une génération Image 5 authentifiée et le débit réel des crédits restent à valider.**

Adobe distingue les deux modèles dans sa
[documentation Photoshop](https://helpx.adobe.com/photoshop/desktop/create-open-import-images/create-images/edit-images-with-generative-fill.html).

### Authentification

Le client utilise un jeton de sa session Adobe IMS dans `Authorization: Bearer …`
et son identifiant public de client dans `X-api-key`.
Le HTML annonce `clio-playground-web` comme client IMS et inclut `firefly_api` dans
les scopes. Cet identifiant public n'est pas un secret et ne donne aucun droit à lui
seul. Il ne remplace pas une session personnelle autorisée.

Pour une intégration, conserver la connexion Adobe dans une session dédiée et
laisser Adobe gérer l'identification. Vérifier sur une session réelle l'identifiant,
les en-têtes effectivement utilisés et leur renouvellement. Un jeton copié une fois
ne constitue pas une connexion durable.

### Envoi des pixels

La branche `fill` passe son image et son masque au client d'envoi configuré sur
`https://firefly-clio-imaging.adobe.io`, avec le chemin `/v2/storage/image`.
Le corps est constitué des octets de l'image, avec son type MIME. Le code récupère
`images[0].id` pour chaque fichier.

Le même module contient aussi une variante d'envoi vers `firefly.adobe.io` pour
d'autres usages. Ne pas confondre cette variante avec la branche suivie ici.

### Génération

Le client de remplissage pointe vers :

```text
POST https://di-me.ff.adobe.io/v2/images/generate-fill
```

Schéma reconstruit de la requête, sans identifiants réels :

```json
{
  "embedContentCredentials": true,
  "input": {
    "image": { "source": { "id": "IMAGE_UPLOAD_ID" } },
    "mask": { "source": { "id": "MASK_UPLOAD_ID" } }
  },
  "output": { "format": "png" },
  "prompt": ""
}
```

Le code accepte aussi des graines, limitées à trois, et une référence facultative.
La requête standard n'envoie pas le grand identifiant de modèle du catalogue : le
choix du service et du chemin sélectionne ici l'opération.

La réponse peut contenir directement `outputs`, avec
`outputs[].image.presignedUrl`, ou un travail asynchrone avec `links.result.href`.
Le client suit alors ce lien avec authentification. Il gère aussi une annulation.

Le code distingue notamment session invalide, droits insuffisants, crédits épuisés,
limitation de débit, surcharge, filtrage du contenu et détection de risque automatisé.
Un échec ne doit pas entraîner un changement de compte ou une répétition illimitée.

## Intégration proposée dans SG Typer Studio

La première cible serait l'application Electron, qui peut gérer une session Adobe
distincte de l'éditeur et un transport réseau natif.

1. Ajouter un fournisseur « Adobe Firefly » à `web/generative.js`.
2. Prévoir une connexion au compte Adobe dans une fenêtre dédiée. Valider d'abord
   que la connexion et le renouvellement fonctionnent dans ce contexte ; si Adobe
   refuse la fenêtre intégrée, étudier un compagnon dans le navigateur habituel.
3. Exposer dans `desktop/src/preload.js` uniquement l'état de connexion, la génération,
   l'annulation et la déconnexion. Garder les jetons hors du renderer de TypeR.
4. Envoyer la zone composée et sa sélection, puis restituer un `ImageBitmap` à
   `TypeRGenerative.generate()`. L'entrée actuelle reçoit déjà `canvas`, `mask`,
   `prompt`, `signal` et un callback de progression.
5. Raccorder le résultat au fonctionnement existant des calques et de l'annulation.

Points d'attention spécifiques au code actuel :

- Le masque TypeR est **noir là où il faut dessiner**. L'analyse complémentaire du
  module Adobe `741630`, chunk `58124`, retrouve la conversion du masque de sélection
  en niveaux de gris opaques : blanc dans la sélection. Le connecteur inverse donc
  le masque TypeR ; un test asymétrique vérifie les pixels envoyés. La validation
  auprès du service authentifié reste nécessaire.
- Le chemin générique exige actuellement une clé API et choisit entre Google et
  fal.ai. Il faut ajouter une branche dédiée, pas seulement un élément au catalogue.
- Le prompt vide est actuellement remplacé par une longue instruction de nettoyage.
  Tester le remplissage Adobe sans prompt et le retrait explicite de texte avant
  de choisir son comportement par défaut.
- Afficher les crédits Adobe selon les informations disponibles, sans annoncer un
  prix nul ou des générations illimitées.
- Respecter les restrictions de dimensions, garder la correspondance exacte entre
  image et masque et limiter la réinsertion à la sélection originale.
- Valider les domaines des liens retournés ; ne pas transmettre le jeton Adobe à
  une URL arbitraire ou aux téléchargements de résultats présignés.

Pour TypeR dans un navigateur, les appels directs rencontrent les contraintes de
session et de CORS. Une extension ou un compagnon local authentifié serait une
architecture distincte, à valider. Ne pas publier les jetons dans le site ni les
faire transiter par un proxy tiers.

## Validation nécessaire avant livraison

Effectuer une génération sur une image de test avec un compte autorisé, vérifier
le modèle et le débit de crédits, puis comparer la zone sélectionnée et les pixels
extérieurs. Tester ensuite une session expirée et l'annulation, et confirmer que
Photoshop reste fermé. Un test de transport simulé ne prouverait pas l'accès Adobe.

## Autres pistes examinées

- [OmniRoute, client Firefly](https://github.com/cheaper-inference/OmniRoute/blob/main/open-sse/services/adobeFireflyClient.ts)
  et [adobe2api-plus](https://github.com/songsongQAQ/adobe2api-plus) : les versions
  consultées montrent principalement l'accès aux modèles partenaires via
  `firefly-3p.ff.adobe.io`. Leur existence ne valide pas le remplissage Adobe ni
  les droits du compte de l'utilisateur. Ne pas installer leurs gestionnaires de
  comptes pour ce seul besoin.
- Pont Photoshop UXP : un auteur a confirmé le **16 janvier 2026** que
  `syntheticFill` fonctionne dans son plugin, après l'exemple fourni par un autre
  développeur. C'est une confirmation explicite, pas une étude de fiabilité.
  [Discussion Adobe](https://forums.creativeclouddeveloper.com/t/can-i-use-generative-fill-in-uxp-photoshop-plugin/11638).
- Un auteur présente aussi son panneau GenFill le **28 juillet 2023**, avec des
  exemples, sur [Reddit](https://www.reddit.com/r/adobeFirefly/comments/15byv8s).
  Il s'agit d'un second témoignage d'auteur, ancien, et non d'une validation de la
  version actuelle. Ces deux témoignages concernent Photoshop ouvert, contrairement
  à l'architecture privilégiée ici.

## Sources techniques et reproductibilité

Les preuves de protocole viennent du code public Adobe, téléchargé sans connexion
ni exécution, puis analysé comme texte. Aucun jeton, cookie ou fichier de compte
n'a été lu. Les sources sont celles du build servi le jour de la recherche :

- [Bundle commun](https://firefly.adobe.com/spl-static/js/bundle.5f9a610ade251531.min.js) :
  modules `191778` (client, authentification, envoi) et `309690` (routes de stockage).
- Le chunk `28474`, dont l'URL et le SHA-256 figurent dans le manifeste voisin :
  modules `14809` (requête et réponse du remplissage) et `708765` (domaines).
- Le chunk `51685` : utilisation du service par l'éditeur et métadonnées de génération.

Le fichier `firefly-public-evidence.json` conserve les URLs et empreintes des
sources consultées. Les fichiers minifiés Adobe complets ne sont pas ajoutés au dépôt.
