function sumDigits(value) {
  return String(value)
    .replace(/\D/g, '')
    .split('')
    .reduce((sum, digit) => sum + Number(digit), 0);
}

function reduceNumber(value, keepMaster = true) {
  let n = Math.abs(Math.trunc(value));
  while (n > 9) {
    if (keepMaster && (n === 11 || n === 22 || n === 33)) {
      break;
    }
    n = sumDigits(n);
  }
  return n || 1;
}

function nameDigitSum(name = '') {
  let sum = 0;

  for (const ch of name.toLowerCase()) {
    if (ch >= 'а' && ch <= 'я') {
      sum += ch.charCodeAt(0) - 'а'.charCodeAt(0) + 1;
    } else if (ch >= 'a' && ch <= 'z') {
      sum += ch.charCodeAt(0) - 'a'.charCodeAt(0) + 1;
    }
  }

  return reduceNumber(sum);
}

function hashLabel(value = '') {
  let hash = 0;
  for (const ch of value) {
    hash = (hash * 31 + ch.charCodeAt(0)) % 100000;
  }
  return hash;
}

/** Детерминированные коды из анкеты — AI объясняет логику, но не меняет числа. */
export function computePersonalityCodes(data) {
  const [day, month, year] = data.birth_date.split('.').map(Number);
  const [hour, minute] = data.birth_time.split(':').map(Number);

  const lifePath = reduceNumber(sumDigits(day) + sumDigits(month) + sumDigits(year));
  const nameNumber = nameDigitSum(data.name);
  const numerologyCode = `${lifePath}${nameNumber}`;

  const genderOffset = data.gender === 'male' ? 11 : 13;
  const socionicsRaw = hour * 60 + minute + day * month + genderOffset;
  const socionicsCode = String((socionicsRaw % 900) + 100);

  const placeSeed =
    data.birth_place_lat != null && data.birth_place_lon != null
      ? Math.round(Math.abs(data.birth_place_lat * 100) + Math.abs(data.birth_place_lon * 100))
      : hashLabel(data.birth_place_label || data.birth_place || '');
  const synthesisCode = String(((placeSeed + year + month * 7) % 900) + 100);

  const fullCode = `${numerologyCode}${socionicsCode}${synthesisCode}`;

  return {
    fullCode,
    numerologyCode,
    socionicsCode,
    synthesisCode,
    numerologyFormula:
      `число жизненного пути ${lifePath} (из даты ${data.birth_date}) + число имени ${nameNumber} (из «${data.name}») → ${numerologyCode}`,
    socionicsFormula:
      `время рождения ${data.birth_time}, день×месяц (${day}×${month}) и пол (${data.gender_label}) → ${socionicsCode}`,
    synthesisFormula:
      `место рождения (${data.birth_place_label}) + год и месяц рождения → синтез астрологии, Human Design и ведической системы → ${synthesisCode}`,
  };
}
