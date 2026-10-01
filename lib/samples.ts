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

/** 첫 화면에 여는 기본 상품 */
export const DEFAULT_SAMPLE_ID = "wholeCancer";

export const SAMPLES: Sample[] = [
  { id: "whole", label: "종신보험 (사망·80% 이상 장해)", hint: "작성법 견본 — 항목마다 설명 주석", yaml: `# 산출방법서 조건 — 종신보험
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
  waiver: false       # 납입만 면제되는 추가 사유가 없으면 false → 납입자수 = 유지자수
rates:                # role: death 사망 · incidence 최초발생 · recurring 반복지급 · waiver 납입면제 · other 기타
${Q}
  - id: r80
    name: 80% 이상 장해율
    role: incidence
    source: 경험생명표(가상) 80%이상 재해장해율 + 질병장해율
${EXPENSES}
benefits:
  - id: b1
    name: 사망·80% 이상 장해
    role: death       # 사망형 — 탈퇴 사유 전부에 같은 보험금
    multiple: 1       # 보장금액 = 보험가입금액 × 1배 (보험료·준비금은 1원당으로 내고 맨 뒤에 곱한다)
    endAge: 110       # 보험기간 — 종신(110세)
    exitRateIds: [q, r80]   # 유지자수·납입자수 = 1 − q − r + q·r/2
${NOTES}
` },
  { id: "twoMajor", label: "2대질병 진단보험 (80세 만기)", hint: "진단형 — 사망과 진단이 함께 탈퇴", yaml: `meta:
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
  waiver: false
rates:
${Q}
  - id: r2
    name: 2대질병 발생률
    role: incidence
    source: 경험생명표(가상) 뇌출혈 + 급성심근경색증 발생률
${EXPENSES}
benefits:
  - id: b1
    name: 2대질병 진단
    role: incidence
    multiple: 1
    endAge: 80
    exitRateIds: [q, r2]    # 급부 위험률은 탈퇴 사유 가운데 사망이 아닌 것(2대질병 발생률)
${NOTES}
` },
  { id: "noRefund", label: "무해지환급형 암보험 (해지율 3%)", hint: "저해지·무해지 — 해지율과 환급률", yaml: `meta:
  productName: 무해지환급형 암보험
  kind: 무해지환급형
product:
  category: 생명보험 / 건강(암)
  types: [1종(무해지환급형), 2종(표준형)]
  terms:
    - { term: 100세만기, pay: 10·20·30년납, age: 만15세 ~ 65세, ageF: 만15세 ~ 70세 }
  payFreqs: [월납, 연납]
  renewal: 비갱신형
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: false
  lapse:
    - { label: 무해지환급형, rate: 3%, duringPayOnly: true }
  lowRatio: 0%        # 납입기간 중 해지환급금 = 표준형 × 0%
rates:
${Q}
  - id: rc
    name: 암발생률
    role: incidence
    source: 경험생명표(가상) 암발생률
${EXPENSES}
benefits:
  - id: b1
    name: 암 진단
    role: incidence
    multiple: 1
    endAge: 100
    waitDays: 90      # 면책·삭감 기간 — 90일 면책(지급 0%)
    exitRateIds: [q, rc]
${NOTES}
` },
  { id: "waiverSupport", label: "보험료납입지원 3대질병", hint: "추가 납입면제 사유 — 80% 이상 장해", yaml: `meta:
  productName: 보험료납입지원 적용 3대질병보험
  kind: 표준형(완전 환급)
product:
  category: 생명보험 / 건강(진단)
  terms:
    - { label: 주계약, term: 80세만기, pay: 20년납, age: 만15세 ~ 60세 }
    - { label: 보험료납입지원, term: 80세만기, pay: 20년납, age: 만15세 ~ 60세 }
  payFreqs: [월납]
basis:
  interest: 2.5%
  standardInterest: 3.25%
  waiver: true        # 3대질병은 이미 탈퇴 사유 — 80% 이상 장해만 납입을 추가로 면제
rates:
${Q}
  - id: r3
    name: 3대질병 발생률
    role: incidence
    source: 경험생명표(가상) 암 + 뇌출혈 + 급성심근경색증 발생률
  - id: f80
    name: 80% 이상 장해율
    role: waiver
    source: 경험생명표(가상) 80%이상 재해장해율 + 질병장해율
${EXPENSES}
benefits:
  - id: b1
    name: 3대질병 진단
    role: incidence
    multiple: 1
    endAge: 80
    exitRateIds: [q, r3]
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
];
