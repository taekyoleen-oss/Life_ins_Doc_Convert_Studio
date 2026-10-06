import { parseDocument } from "yaml";

/**
 * 조건 샘플. 사용자가 고쳐 쓰는 견본이라 YAML 글 그대로 둔다(주석이 작성법 안내다).
 * 값은 flexible_insurance 설계기 레시피와 같다 — 두 앱의 산출방법서를 맞대어 볼 수 있게.
 */

const EXPENSES = `expenses:           # 기호: α_S α_P β_S β_G β′ γ (산출방법서형) 또는 α β γ
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 1%, phase: 초년도 }
  - { group: 계약체결비용, symbol: α_P, basis: 기준연납순보험료, times: 1배, phase: 초년도 }
  - { group: 계약관리비용, symbol: β_S, basis: 매년 보험가입금액, rate: 1.5/1000, phase: 납입중 }
  - { group: 계약관리비용, symbol: β_G, basis: 영업보험료, rate: 4.5%, phase: 납입중 }
  - { group: 계약관리비용, symbol: β′, basis: 매년 보험가입금액, rate: 1/1000, phase: 납입후 }
  - { group: 수금비용, symbol: γ, basis: 영업보험료, rate: 2.5% }`;

/** 입력 화면의 [산출방법서형 6줄 넣기] — 자유설계보험 사업비(α_S·α_P·β_S·β_G·β′·γ)와 같은 기호 */
export const EXPENSE_PRESET = (parseDocument(EXPENSES).toJS() as { expenses: Record<string, unknown>[] }).expenses;

const NOTES = `surrender:
  deductionYears: 7
  notes:
    - 해약공제 기준 신계약비는 적용기초율과 표준기초율로 구한 신계약비 중 작은 쪽으로 한다.
reserve:
  notes:
    - 회계연도말 보험료적립금은 적용기초율 적립금과 표준기초율 적립금 중 큰 금액으로 한다.
    - 연중 보간은 하지 않고 연말 기준으로 산출한다.`;

const Q = `  - id: q
    name: 사망률
    role: death
    source: 경험생명표(가상) 사망률`;

export interface Sample { id: string; label: string; hint: string; yaml: string }

/** 검산 기준 상품 — samples/09 · 자유설계보험 default-product 시험이 이 상품으로 두 앱을 맞대어 본다(첫 화면은 START_SAMPLE_ID) */
export const DEFAULT_SAMPLE_ID = "wholeCancer";

export const SAMPLES: Sample[] = [
  { id: "whole", label: "종신보험 (사망)", hint: "작성법 견본 — 유지자 둘(사망·80% 장해 / 사망) · 사망 보장 · 항목마다 설명 주석", yaml: `# 산출방법서 조건 — 종신보험
# 왼쪽을 고치면 오른쪽 산출방법서가 바로 바뀝니다. 이율·사업비는 "2.5%", "1.5/1000" 처럼 적습니다.
# 한 줄을 고르면 오른쪽에서 그 조건이 만든 부분이 노랗게 표시됩니다(반대 방향도 됩니다).
meta:
  productName: 종신보험
  kind: 표준형(완전 환급)
product:              # 가입 조건 — 산출방법서에 싣는 판매 범위(정보). 계산할 계약 한 점은 자유설계보험 M02 계약정보에서 정한다
  category: 생명보험 / 종신
  types: [표준형(완전 환급)]
  terms:              # 보험기간 · 보험료 납입기간 · 가입나이 (사업방법서 표와 같은 모양)
    - { term: 110세만기, pay: 10·15·20년납, age: 만15세 ~ 65세 }
    - { term: 110세만기, pay: 30년납, age: 만15세 ~ 50세 }
  payFreqs: [월납, 연납]
  sumLimit: 1천만원 ~ 10억원
  renewal: 비갱신형
basis:
  interest: 2.5%      # 적용(예정)이율
  standardInterest: 3.25%
  waiver: true        # 납입면제 — 80% 이상 장해 시 이후 보험료 면제. 납입자 = [납입] 유지자 lx(1)(사망 · 80% 장해 아닌 유지자)
  waiverRateIds: [r80]
rates:                # role: death 사망 · incidence 최초발생 · recurring 반복지급 · waiver 납입면제 · other 기타
${Q}
  - id: r80
    name: 80% 이상 장해율
    role: incidence
    source: 경험생명표(가상) 80%이상 재해장해율 + 질병장해율
${EXPENSES}
survivors:            # 유지자 lx(k) — 탈퇴 위험률로 줄어드는 사람 수(lx · Dx · Nx). 보험금은 이 가운데 하나를 대상자수로 고른다
  - id: s1            # lx(1) 사망, 80% 이상 장해 아닌 유지자 — 납입자: 보험료 납입기수(N*)에 쓴다(D′ · N′). 80% 장해면 이후 보험료 납입면제
    exitRateIds: [q, r80]   # 대상 위험률 — 위험률 합성 Q^{(1)} = min(1, q + r − q·r/2) (combos 에 적지 않으면 저절로 만든다)
    payFor: [주계약]
  - id: s2            # lx(2) 사망 아닌 유지자 — l_{x+t+1} = l_{x+t} × (1 − q). 보험금(사망)의 대상자수
    exitRateIds: [q]
benefits:
  - id: b1
    name: 사망
    role: death       # 사망형 — 대상자수 × 사망률
    multiple: 1       # 보장금액 = 보험가입금액 × 1배 (보험료·준비금은 1원당으로 내고 맨 뒤에 곱한다)
    endAge: 110       # 보험기간 — 종신(110세)
    survivorId: s2    # 대상자수 = lx(2)
    exitRateIds: [q]
${NOTES}
` },
  { id: "wholeCancer", label: "종신보험(암진단 포함)", hint: "기본 상품 — 사망·80% 장해(1배) + 암 진단(0.5배, 90일 면책) · 장해·암 진단 시 납입면제", yaml: `# 산출방법서 조건 — 종신보험(암진단 포함) · 이 앱의 기본 상품
# 왼쪽을 고치면 오른쪽 산출방법서가 바로 바뀝니다. 이율·사업비는 "2.5%", "1.5/1000" 처럼 적습니다.
# 한 줄을 고르면 오른쪽에서 그 조건이 만든 부분이 노랗게 표시됩니다(반대 방향도 됩니다).
meta:
  productName: 종신보험(암진단 포함)
  kind: 표준형(완전 환급)
product:              # 가입 조건 — 산출방법서에 싣는 판매 범위(정보). 계산할 계약 한 점은 자유설계보험 M02 계약정보에서 정한다
  category: 생명보험 / 종신
  types: [표준형(완전 환급)]
  terms:              # 보험기간 · 보험료 납입기간 · 가입나이 (사업방법서 표와 같은 모양)
    - { term: 110세만기, pay: 10·15·20년납, age: 만15세 ~ 65세 }
    - { term: 110세만기, pay: 30년납, age: 만15세 ~ 50세 }
  payFreqs: [월납, 연납]
  sumLimit: 1천만원 ~ 10억원
  renewal: 비갱신형
basis:
  interest: 2.5%      # 적용(예정)이율
  standardInterest: 3.25%
  waiver: true        # 납입면제 — 80% 이상 장해·암 진단 시 이후 보험료를 면제한다(사망은 계약 소멸 — 탈퇴로 줄어든다)
  waiverRateIds: [r80, rc]   # 납입면제 사유. 그 담보의 탈퇴 사유인 것은 탈퇴로 이미 줄었으므로 다시 빼지 않는다
rates:                # role: death 사망 · incidence 최초발생 · recurring 반복지급 · waiver 납입면제 · other 기타
${Q}
  - id: r80
    name: 80% 이상 장해율
    role: incidence
    source: 경험생명표(가상) 80%이상 재해장해율 + 질병장해율
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
${EXPENSES}
benefits:
  - id: b1
    name: 사망·80% 이상 장해
    role: death       # 사망형 — 탈퇴 사유 전부에 같은 보험금
    multiple: 1       # 보장금액 = 보험가입금액 × 1배 — 보험료·준비금은 1원당으로 내고 맨 뒤에 가입금액 × 배수를 곱한다
    endAge: 110       # 보험기간 — 종신(110세)
    exitRateIds: [q, r80]   # 유지자수 = 1 − q − r + q·r/2 · 납입자수는 암 진단(납입면제)으로 더 준다
  - id: b2
    name: 암 진단
    role: incidence   # 진단형 — 기본 식(사망 + 암 진단이 탈퇴)
    multiple: 0.5     # 사망보험금의 50%
    endAge: 100
    waitDays: 90      # 면책·삭감 기간 90일, 지급 0% (면책) — 첫해 급부는 (1 − 3/12) 배. 50% 삭감이면 waitPayRatio: 50%
    exitRateIds: [q, rc]    # 급부 위험률 = 탈퇴 사유 가운데 암발생률 · 납입자수는 80% 이상 장해(납입면제)로 더 준다
${NOTES}
` },
  { id: "cancer", label: "암진단 보장보험 (무해지환급형 · 해지율 3%)", hint: "암 단일탈퇴 — 사망 시 책임준비금 지급 · 90일 면책 · 무해지", yaml: `# 산출방법서 조건 — 암진단 보장보험
# 사망 시에는 책임준비금을 지급하므로 사망은 급부·준비금에 순효과가 없다 → 암발생률만 탈퇴율로 쓰는 단일탈퇴.
meta:
  productName: 암진단 보장보험
  kind: 무해지환급형
product:
  category: 생명보험 / 건강(암)
  types: [1종(무해지환급형), 2종(표준형)]
  terms:
    - { term: 100세만기, pay: 10·20·30년납, age: 만15세 ~ 65세, ageF: 만15세 ~ 70세 }
  payFreqs: [월납, 연납]
  renewal: 비갱신형
basis:               # 기존 암보험 산출방법서(설계형 암보험 cancer-2026)와 같은 기초율·사업비
  interest: 3.25%
  standardInterest: 3.25%
  waiver: false
  lapse:
    - { label: 무해지환급형, rate: 3%, duringPayOnly: true }
  lowRatio: 0%        # 납입기간 중 해지환급금 = 표준형 × 0%
rates:
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
expenses:
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 5/1000, phase: 초년도 }
  - { group: 계약체결비용, symbol: α_P, basis: 기준연납순보험료, times: 1배, phase: 초년도 }
  - { group: 계약관리비용, symbol: β_S, basis: 매년 보험가입금액, rate: 1.2/1000, phase: 납입중 }
  - { group: 계약관리비용, symbol: β_G, basis: 영업보험료, rate: 7%, phase: 납입중 }
  - { group: 계약관리비용, symbol: β′, basis: 매년 보험가입금액, rate: 1/1000, phase: 납입후 }
  - { group: 수금비용, symbol: γ, basis: 영업보험료, rate: 4% }
benefits:
  - id: b1
    name: 암 진단
    role: incidence
    multiple: 1
    endAge: 100
    waitDays: 90      # 면책·삭감 기간 — 90일 면책(지급 0%) → 첫해 급부 × 3/4
    exitRateIds: [rc]   # 단일탈퇴 — 사망은 탈퇴 사유에 넣지 않는다(사망 시 책임준비금 지급)
surrender:
  deductionYears: 7
  notes:
    - 해약공제 기준 신계약비는 적용기초율과 표준기초율로 구한 신계약비 중 작은 쪽으로 한다.
reserve:
  notes:
    - 사망 시에는 책임준비금을 지급하므로 사망은 급부 현가와 준비금에 순효과가 없다. 그래서 암발생률만 탈퇴율로 쓰는 단일탈퇴로 산출한다.
    - 회계연도말 보험료적립금은 적용기초율 적립금과 표준기초율 적립금 중 큰 금액으로 한다.
    - 연중 보간은 하지 않고 연말 기준으로 산출한다.
` },
  { id: "twoMajor", label: "2대질병 진단보험 (80세 만기)", hint: "뇌출혈·급성심근경색증 담보를 따로 — 납입자수는 1 − (1 − 뇌출혈)(1 − 급성심근경색증)", yaml: `# 산출방법서 조건 — 2대질병 진단보험
# 뇌출혈 진단과 급성심근경색증 진단을 따로 보장한다. 담보마다 그 질병이 아직 생기지 않은 사람(유지자수 l)에게 보험금을 준다.
# 보험료는 둘 중 하나라도 생기면 면제 — 납입자수의 질병 발생률은 F = 1 − (1 − 뇌출혈) × (1 − 급성심근경색증)(질병끼리 곱),
# 사망과는 Q′ = q + F − q·F/2(겹치는 부분 절반). 자동 식이 이 규칙으로 만든다.
meta:
  productName: 2대질병 진단보험
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 건강(진단)
  terms:
    - { term: 80세만기, pay: 10·15·20년납, age: 만15세 ~ 60세 }
  payFreqs: [월납]
  sumLimit: 1천만원 ~ 5천만원
  renewal: 비갱신형
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: true        # 뇌출혈 또는 급성심근경색증 진단 시 이후 보험료 면제
  waiverRateIds: [rs, ra]
rates:
${Q}
  - id: rs
    name: 뇌출혈 발생률
    role: incidence
    source: 경험생명표(가상) 뇌출혈 발생률
  - id: ra
    name: 급성심근경색증 발생률
    role: incidence
    source: 경험생명표(가상) 급성심근경색증 발생률
${EXPENSES}
benefits:
  - id: b1
    name: 뇌출혈 진단
    role: incidence
    multiple: 1
    endAge: 80
    exitRateIds: [q, rs]    # 뇌출혈이 아직 생기지 않은 생존자에게 지급 — 지급하면 이 담보는 소멸
  - id: b2
    name: 급성심근경색증 진단
    role: incidence
    multiple: 1
    endAge: 80
    exitRateIds: [q, ra]    # 급성심근경색증이 아직 생기지 않은 생존자에게 지급
${NOTES}
` },
  { id: "hospital", label: "입원보험(특약) · 암입원 1일당", hint: "반복지급(일당형) — 사망만 탈퇴 · 급부 = 암입원율 · 90일 면책", yaml: `# 산출방법서 조건 — 암입원특약
# 입원 1일당 정액. 입원은 여러 번 생겨도 담보가 소멸하지 않으므로 탈퇴 사유는 사망뿐이다.
# 급부 발생률 = 1일 기준 암입원율 × 365 = 한 해 기대 입원일수.
meta:
  productName: 암입원특약
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 특약(입원)
  terms:
    - { label: 암입원특약, term: 100세만기, pay: 10·20년납, age: 만15세 ~ 65세 }
  payFreqs: [월납]
  sumLimit: 1일당 1만원 ~ 5만원
  renewal: 비갱신형
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false       # 특약은 납입면제·해지율을 적용하지 않는다
rates:
${Q}
  - id: ch
    name: 암입원율
    role: recurring
    source: 경험생명표(가상) 암입원율 × 365일
${EXPENSES}
benefits:
  - id: b1
    name: 암 입원(1일당)
    unit: 암입원특약
    role: recurring   # 반복지급 — 입원 1일마다 지급하고 담보는 그대로
    amount: 30000     # 1일당 3만원 — 일당은 가입금액의 배수가 아니라 따로 정한다
    endAge: 100
    waitDays: 90      # 암 관련 90일 면책 → 첫해 급부 × 3/4
    rateId: ch        # 급부 발생률 — 탈퇴 사유가 아닌 위험률이라 따로 적는다
    exitRateIds: [q]
${NOTES}
` },
  { id: "surgery", label: "수술보험(특약) · 암수술", hint: "수술 시 정액 — 탈퇴 사망·암 · 급부 = 암수술률(암발생률 × 0.8) · 90일 면책", yaml: `# 산출방법서 조건 — 암수술특약
# 암으로 수술을 받으면 정액을 준다. 탈퇴 사유는 사망과 암 발생, 급부 발생률은 암수술률(가상 — 암발생률 × 0.8).
meta:
  productName: 암수술특약
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 특약(수술)
  terms:
    - { label: 암수술특약, term: 100세만기, pay: 10·20년납, age: 만15세 ~ 65세 }
  payFreqs: [월납]
  sumLimit: 100만원 ~ 1천만원
  renewal: 비갱신형
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false
rates:
${Q}
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
  - id: cs
    name: 암수술률
    role: incidence
    source: 경험생명표(가상) 암수술률 (암발생률 × 0.8)
${EXPENSES}
benefits:
  - id: b1
    name: 암 수술
    unit: 암수술특약
    role: incidence
    multiple: 0.1     # 보장금액 = 가입금액 × 0.1 (1억이면 1천만원)
    endAge: 100
    waitDays: 90
    rateId: cs        # 급부 발생률은 탈퇴 사유(암발생률)와 다른 암수술률
    exitRateIds: [q, rc]
${NOTES}
` },
  { id: "support", label: "보험료납입지원특약 (3대질병)", hint: "3대질병 진단 시 남은 보험료를 매월 지원 — 급부 = 남은 기간 월 지원액의 확정연금 현가", yaml: `# 산출방법서 조건 — 보험료납입지원특약(3대질병)
# 암·뇌출혈·급성심근경색증 가운데 하나라도 진단되면 주계약 납입기간이 끝날 때까지 매월 지원액을 준다(지급약정기간 — 생존과 상관없이 확정).
# 보장금액 = 월 지원액(주계약 월보험료). 급부 = 진단 시점(연중앙)부터 납입기간 끝까지 남은 달의 확정연금 현가.
meta:
  productName: 보험료납입지원특약(3대질병)
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 특약(납입지원)
  terms:
    - { label: 보험료납입지원특약, term: 80세만기, pay: 주계약 납입기간과 같음, age: 만15세 ~ 60세 }
  payFreqs: [월납]
  renewal: 비갱신형
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false       # 지원 사유가 곧 탈퇴 사유 — 진단되면 이 특약은 소멸한다
rates:
${Q}
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
  - id: rs
    name: 뇌출혈 발생률
    role: incidence
    source: 경험생명표(가상) 뇌출혈 발생률
  - id: ra
    name: 급성심근경색증 발생률
    role: incidence
    source: 경험생명표(가상) 급성심근경색증 발생률
expenses:           # 납입 후 유지비(β′)는 두지 않는다 — 지원은 납입기간에 끝나 그 뒤에는 관리할 급부가 없다
  - { group: 계약체결비용, symbol: α_S, basis: 보험가입금액, rate: 1%, phase: 초년도 }
  - { group: 계약체결비용, symbol: α_P, basis: 기준연납순보험료, times: 1배, phase: 초년도 }
  - { group: 계약관리비용, symbol: β_S, basis: 매년 보험가입금액, rate: 1.5/1000, phase: 납입중 }
  - { group: 계약관리비용, symbol: β_G, basis: 영업보험료, rate: 4.5%, phase: 납입중 }
  - { group: 수금비용, symbol: γ, basis: 영업보험료, rate: 2.5% }
benefits:
  - id: b1
    name: 3대질병 진단 시 보험료 지원
    unit: 보험료납입지원특약
    role: incidence
    amount: 100000    # 월 지원액 10만원 — 주계약 월보험료
    endAge: 80
    exitRateIds: [q, rc, rs, ra]   # 급부 = 사망 아닌 탈퇴 사유(암·뇌출혈·급성심근경색증) 가운데 하나라도
${NOTES}
formulas:             # 보험금의 현가 — 보장금액의 배수 S 를 남은 달의 확정연금 현가로 바꾼 식(자동 식 위에 얹힌다)
  - section: 보험금
    label: 보험금 — 3대질병 진단 시 보험료 지원
    text: |-
      대상자수 — lx(1) 사망, 암, 뇌출혈, 급성심근경색증 아닌 유지자 를 가져다 쓴다
      l_{x+t} = l^{(1)}_{x+t}
      D_{x+t} = D^{(1)}_{x+t}
      N_{x+t} = N^{(1)}_{x+t}
      보험료 납입 — 유지자 lx(1) (보험료납입지원특약 [납입])
      D′_{x+t} = D^{(1)}_{x+t}
      N′_{x+t} = N^{(1)}_{x+t}
      보장금액의 배수 — 진단(연중앙)부터 납입기간 끝까지 남은 달마다 월 지원액을 확정 지급한다
      S_t = if( t < m, ( 1 − v^{m − t − ½} )/( 1 − v^{1/12} ), 0 )
      급부 발생자
      C_{x+t} = l^{(1)}_{x+t}·R^{(1)}_{x+t}·v^{t+½}
      보험금 현가의 누계
      M_{x+t} = Σ_{u=t}^{n−1} S_u·C_{x+u}
      보험금 현가 (PVB) — 월 지원액 1원당
      PVB = M_x
    note: S_t 는 월 지원액 1원을 남은 12·(m − t) − 6 달 동안 매월 초에 주는 확정연금의 진단 시점 현가다. 지급약정기간 동안에는 생존과 상관없이 준다. 납입기간이 끝난 뒤(t ≥ m)에는 지원할 보험료가 없어 0 이다. R^{(1)} 은 유지자 lx(1) 식의 질병 발생률(암·뇌출혈·급성심근경색증의 곱 결합)이다.
` },
  { id: "cancerPlan", label: "암보험 (암진단 + 암입원·암수술 특약)", hint: "주계약 암진단 · 특약 둘(암입원 1일당 · 암수술) — 100세 만기 · 90일 면책 · 암 진단 시 납입면제 · 사망률 미반영", yaml: `# 산출방법서 조건 — 암보험 (주계약 암진단 + 특약 암입원 · 암수술)
# 위 [주계약] · [암입원특약] · [암수술특약] 탭이 계약 단위다. 담보의 unit 이름이 탭을 만든다.
# 특약은 독립특약 — 주계약의 유지자·납입면제를 가져오지 않고 저마다 기준 인원 100,000 명으로 산출한다.
# 사망률은 쓰지 않는다 — 사망 시에는 책임준비금을 지급하므로 사망은 급부·준비금에 순효과가 없다고 본다(암 단일탈퇴).
meta:
  productName: 암보험
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 건강(암)
  types: [표준형(완전 환급)]
  terms:
    - { label: 주계약(암진단), term: 100세만기, pay: 10·20·30년납, age: 만15세 ~ 65세 }
    - { label: 암입원특약, term: 100세만기, pay: 주계약과 같음, age: 만15세 ~ 65세 }
    - { label: 암수술특약, term: 100세만기, pay: 주계약과 같음, age: 만15세 ~ 65세 }
  payFreqs: [월납, 연납]
  sumLimit: 1천만원 ~ 1억원 (암입원 1일당 3만원)
  renewal: 비갱신형
basis:
  interest: 2.5%      # 적용(예정)이율
  standardInterest: 3.25%
  waiver: false       # 주계약은 암 진단 시 소멸(암 단일탈퇴)하므로 납입도 그때 끝난다. 특약은 독립특약이라 주계약의 납입면제를 가져오지 않는다
rates:                # 사망률 없음 — 암발생률 · 암입원율 · 암수술률만
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
  - id: ch
    name: 암입원율
    role: recurring
    source: 경험생명표(가상) 암입원율 × 365일
  - id: cs
    name: 암수술률
    role: incidence
    source: 경험생명표(가상) 암수술률 (암발생률 × 0.8)
${EXPENSES}
benefits:
  - id: b1
    name: 암 진단
    role: incidence   # 진단형 — 진단되면 지급하고 이 담보는 소멸
    multiple: 1       # 보장금액 = 보험가입금액 × 1배
    endAge: 100       # 100세 만기 — 99세까지 보장
    waitDays: 90      # 90일 면책(지급 0%) → 첫해 급부 × 3/4
    exitRateIds: [rc] # 암 단일탈퇴 — 사망은 탈퇴 사유에 넣지 않는다
  - id: b2
    name: 암 입원(1일당)
    unit: 암입원특약
    role: recurring   # 반복지급 — 입원 1일마다 지급하고 담보는 그대로
    amount: 30000     # 1일당 3만원 — 일당은 가입금액의 배수가 아니라 따로 정한다
    endAge: 100
    waitDays: 90
    rateId: ch        # 급부 발생률 — 탈퇴 사유가 아닌 위험률이라 따로 적는다
    exitRateIds: []   # 탈퇴 사유 없음(사망률 미반영) — 독립특약: 기준 인원 100,000 명을 그대로 유지한다(납입자도 같다)
  - id: b3
    name: 암 수술
    unit: 암수술특약
    role: incidence
    multiple: 0.1     # 보장금액 = 가입금액 × 0.1 (1억이면 1천만원)
    endAge: 100
    waitDays: 90
    rateId: cs        # 급부 발생률은 탈퇴 사유(암발생률)와 다른 암수술률
    exitRateIds: [rc]
surrender:
  deductionYears: 7
  notes:
    - 해약공제 기준 신계약비는 적용기초율과 표준기초율로 구한 신계약비 중 작은 쪽으로 한다.
reserve:
  notes:
    - 사망 시에는 책임준비금을 지급하므로 사망은 급부 현가와 준비금에 순효과가 없다. 그래서 사망률을 쓰지 않고 산출한다.
    - 회계연도말 보험료적립금은 적용기초율 적립금과 표준기초율 적립금 중 큰 금액으로 한다.
    - 연중 보간은 하지 않고 연말 기준으로 산출한다.
` },
];

/** 공유·시험용으로 [샘플] 메뉴에 보이는 것 — 나머지는 코드·시험에만 두고 하나씩 늘린다(주소 ?all 이면 모두, ?sample=<id> 로 바로 연다) */
export const SHARED_SAMPLE_IDS = ["whole", "cancerPlan"];
/** 첫 화면에 여는 상품 — 종신보험(사용자 결정 2026-10-06 — 하루 동안 암보험이었다가 되돌림) */
export const START_SAMPLE_ID = "whole";
