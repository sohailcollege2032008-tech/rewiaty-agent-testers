# تشغيل الـ AI testers على روايتي

الريبو ده نسخة من [mobile-agent-testers](https://github.com/pierridotite/mobile-agent-testers)، متظبّطة على **OpenCode Go** بـ **deepseek-v4.1-flash** بدل Claude.

| | |
|---|---|
| Repo | `sohailcollege2032008-tech/rewiaty-agent-testers` |
| Model | `deepseek-v4.1-flash` عبر `https://opencode.ai/zen/go` (Anthropic-compatible) |
| Header إلزامي | `x-opencode-session: <أي id>` — بيتحط في `scripts/llm_env.sh` تلقائيًا |
| Secret | `LLM_API_KEY` (مفتاح OpenCode Go) + `ARTIFACT_PASSPHRASE` (تشفير الـ APK) |
| المفاتيح | `results_public.pem` جوه الريبو، والخاص في `~/.mobile-agent-testers/sohailcollege2032008-tech_rewiaty-agent-testers.pem` |

## إيه اللي اتغيّر عن الـ template

`scripts/llm_env.sh` بس (سطرين):

1. `ANTHROPIC_API_KEY="$LLM_API_KEY"` كمان، مش `ANTHROPIC_AUTH_TOKEN` لوحده — OpenCode Go بيرفض `Authorization: Bearer` لوحده (`401 OpenCode Go requires an API key`) وبيفهم `x-api-key`.
2. `ANTHROPIC_CUSTOM_HEADERS="x-opencode-session: ..."` — من غيره `MissingSessionID`. الـ id بيتولّد من `GITHUB_RUN_ID` + اسم الـ persona، وينفع تتحكم فيه بـ `LLM_SESSION_ID`.

مفيش حاجة تانية اتلمست: نفس الـ workflow ونفس كل الأدوات.

## إزاي تشغّله على روايتي

### 1) APK جاهز (الطريق المفضّل دلوقتي)

الـ workflow بيقبل APK مبني من بره، من غير ما يبني هو. `android_build` بياخد أمر تحميل أو نسخ، و`apk_path` المسار النسبي لـ `app_dir`:

```bash
gh workflow run agent-testers.yml -R sohailcollege2032008-tech/rewiaty-agent-testers \
  -f android_personas=layla \
  -f ios_personas=none \
  -f app_dir=. \
  -f app_id=com.sohailcollege.rewiaty \
  -f android_build="curl -fsSL -o rewiaty.apk https://<رابط الـ APK>" \
  -f apk_path=rewiaty.apk \
  -f model=deepseek-v4.1-flash \
  -f llm_base_url=https://opencode.ai/zen/go
```

بدل الـ `curl`: لو الـ APK على جهازك، ارفعه كـ GitHub Release asset في ريبو الـ testers (أو أي لينك مباشر) وحط اللينك. ولو الـ APK جوه ريبو روايتي نفسه كـ artifact/release، ينفع `curl` على الـ release URL.

الـ `app_id` بيُقرأ من الـ APK نفسه كمان (`aapt2 dump packagename`)، فلو مش متأكد سيب اللي بتحطه والباقي بيتصحح لوحده. لو غلط خالص، التطبيق مش هيقوم والـ agent هيقول كده في أول خطوة.

### 2) بناء من السورس (لما كود روايتي يبقى جوه ريبو `rewiaty`)

روايـتي Expo + expo-router في `apps/mobile` (حسب `.factory/ARCHITECTURE.md`). البناء التلقائي للـ Expo في الـ template بيعمل `npx expo prebuild --platform android` بعدين `./gradlew assembleRelease -PreactNativeArchitectures=x86_64`:

```bash
gh workflow run agent-testers.yml -R sohailcollege2032008-tech/rewiaty-agent-testers \
  -f source_repo=sohailcollege2032008-tech/rewiaty \
  -f app_dir=apps/mobile \
  -f app_id=com.sohailcollege.rewiaty \
  -f framework=expo \
  -f android_personas=layla,grace \
  -f ios_personas=none \
  -f model=deepseek-v4.1-flash \
  -f llm_base_url=https://opencode.ai/zen/go
```

`source_repo` خاص؟ الـ workflow بيقرأه بـ `secrets.SOURCE_REPO_TOKEN`؛ العام مش محتاج توكن. وريبو روايتي دلوقتي public، فمفيش حاجة تتعمل.

**تحذير Expo:** التطبيق بيعتمد على `expo-sqlite` و`react-native-webview` و`@gorhom/bottom-sheet`، وكل دي native modules. `assembleRelease` بيطلع APK غير موقّع في مشروع Expo نضيف — لو الـ build فشل من ناحية التوقيع، الحل: `-f android_build="./gradlew assembleDebug"` من جوه `android/` أو بناء الـ APK بره وتمريره بالطريق الأول.

## الـ personas المناسبة لقارئ عربي

`personas.json` فيه 20 persona، 10 على Android. اللي بيهمّنا:

| id | ليه مهمة لروايتي |
|---|---|
| **layla** | `ar-EG`، Pixel 6، 115%، light — **الـ persona العربية الأساسية (RTL)**. هدفها: المهمة الأساسية كاملة + تتأكد إن النصوص والأيقونات والأسهم مقلوبة صح |
| **grace** | Pixel 7 بـ **200% font** — أهم واحدة بعد layla: خط كبير + تشكيل عربي = أول حاجة بتتكسر (سطور مقطوعة، تشكيل مقصوص، headers مقطوعة) |
| **anna** | شاشة صغيرة (Nexus 5, Android 11) بخط 130% — الـ HUD والـ footer «صفحة X من Y» على أصغر شاشة |
| **malik** | سريع، dark mode — الوضع الليلي في القارئ + تقليب سريع |
| **lucia** | تابلت (Pixel Tablet) — لو جربنا layout تابلت للقراية |
| **olga** | rus-RU، بيصطاد النصوص المقطوعة والترجمة الركيكة — يفيد في الـ UI الإنجليزي اللي لسه مش مترجم |

**قبل ما تشغّل روايتي على persona أجنبية:** التطبيق عربي RTL، فـ persona إنجليزي مش هيلاقي حاجة يقولها. شغّل **layla + grace** في أول جولة، وزوّد `anna` لو الشاشات الصغيرة مهمة.

> personas الـ iOS (`amira` ar-SA مثلًا) مش هتشتغل هنا: iOS على macOS runners وبياخد دقايق مضروبة ×10، وإحنا Android أولًا.

## التكلفة (مقاسة من الـ run الفعلي)

كل حاجة بتمشي على **OpenCode Go allowance** (مش فلوس زيادة): كل رد بيرجع `billing_source: "go"` و`cost: 0`. الـ `list_cost` في الـ response هو سعر Zen العادي لو دفعته بالفلوس، وبيتسجل للتقدير بس.

الـ demo الفعلي — run [45418384749](https://github.com/sohailcollege2032008-tech/rewiaty-agent-testers/actions/runs/45418384749)، persona `anna`، Android بس:

| بند | measured |
|---|---|
| زمن الـ run كله | 32 دقيقة (build 6m7s + agent 26m9s) |
| الـ agent | 65 turn، 23 دقيقة (1398 ثانية) |
| tokens | 85,707 in · 25,744 out · 2,040,192 cache-read |
| تقدير Claude Code للتكلفة (`total_cost_usd`) | **$2.09** — ده سعر list تقديري، **مش** اللي اندفع |
| الفلوس المدفوعة فعلًا | **$0** — الحساب على Go allowance (`billing_source: go`) |
| GitHub Actions | مجاني (ريبو public، runners أوبنتو) |

> الرقم المهم لإدارة الميزانية: **agent واحد ≈ $2 تقديري ≈ 2 مليون token cache-read**، بيتخصم من allowance الـ Go. عشان كده الـ persona الواحدة تجربة كافية قبل أي جولة بـ 3 personas.

الـ APK والـ build logs مش بيتحسبوا فلوس، بس كلهم متشفّرين في الـ artifacts.

## بعد الـ run: تقرير مقروء

```bash
bash scripts/collect.sh <run id>       # بينزّل ويفك تشفير كل الـ artifacts
open runs/<run id>/SUMMARY.md          # التقرير: issues مجمّعة + السكرينشوتس
```

`collect.sh` بيحتاج الـ private key في `~/.mobile-agent-testers/<owner>_<repo>.pem` (موجود هنا). لو المفاتيح ضاعت، أعد إنتاجها بـ `openssl genpkey` واعمل commit للـ public key الجديد — التقارير القديمة تبقى غير قابلة للفك.

## الأوامر بالظبط

```bash
# الـ demo اللي شغّلناه فعلًا (1 persona، Android بس، 2.09$ تقديري / 0$ فعلي)
gh workflow run agent-testers.yml -R sohailcollege2032008-tech/rewiaty-agent-testers \
  -f android_personas=anna -f ios_personas=none \
  -f model=deepseek-v4.1-flash -f llm_base_url=https://opencode.ai/zen/go
gh run watch <run id> -R sohailcollege2032008-tech/rewiaty-agent-testers
bash scripts/collect.sh <run id>

# أسرع جولة على روايتي (persona واحدة، APK جاهز)
bash scripts/rewiaty-run.sh <apk-url> layla

# جولة كاملة على APK
bash scripts/rewiaty-run.sh <apk-url> layla,grace,anna

# من غير Claude في الـ grouping
SUMMARY_GROUPING=0 bash scripts/collect.sh <run id>
```

## ملاحظات متجرّبة

- **الـ vision متأكد منها:** deepseek-v4.1-flash بيقرا الصور فعلًا (اختُبر بصورة فيها «REWIATY 42» وإطار أحمر، رد صح بالعربي)، فالسكرينشوتس مش بتتحوّل placeholder.
- **الـ demo نجح:** persona `anna` جابت **14 finding** (in the demo's 11 planted bugs: generic sign-up error، «1 tasks»، empty task stored، keyboard hiding Continue، tiny unlabelled delete، no empty state) + حاجات حقيقية مش مزروعة (welcome sentence مقطوعة، long task بتختفي تحت الـ nav bar، list مش بتعمل scroll، tap على task ميعملش حاجة). التقرير الكامل: `runs/45418384749/anna/results/anna/report.md` + 22 سكرينشوت.
- **الـ grouping بيستخدم Claude على جهازك:** `collect.sh` بيجمّع التكرارات بـ `claude` CLI محلي (الـ template). لو مش عايز أي Claude خالص: `SUMMARY_GROUPING=0 bash scripts/collect.sh <run id>`.
- **ممنوع** `https://opencode.ai/zen/v1` (مدفوع بالرصيد) — دايمًا `/zen/go`.
- **ممنوع** `Authorization: Bearer` لوحده — لازم `x-api-key` كمان.
- الـ logs على ريبو public مكشوفة، عشان كده التقارير والسكرينشوتس بتتشفر بـ RSA قبل الـ upload؛ متحطّش أي سر في inputs الـ workflow (الـ inputs بتتسجل في الـ run).
- **مشكلة معروفة في الـ collect:** بيطبع `WARNING: build-log-android: produced no output` — الـ build log بيتفك عادي في `runs/<id>/build-log-android/results/build-android.log`، فالتحذير شكلي بس.

## المفاتيح (مهم، متضيعهمش)

- `~/.mobile-agent-testers/sohailcollege2032008-tech_rewiaty-agent-testers.pem` — الـ private key اللي بيفك كل التقارير. لو ضاع، التقارير القديمة بتقفل للأبد.
- `~/.mobile-agent-testers/sohailcollege2032008-tech_rewiaty-agent-testers.apk-passphrase` — الـ `ARTIFACT_PASSPHRASE` بتاع تشفير الـ APK بين jobs.
- `results_public.pem` جوّه الريبو = الـ public half بس.
