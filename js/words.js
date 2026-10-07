/* Whole-word practice ("head copy"): pick words made only of letters you have unlocked, and compare answers.
   Pure: no DOM, no audio. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./morse.js'));
  else root.Words = factory(root.Morse);
})(typeof self !== 'undefined' ? self : this, function (Morse) {
  // Common everyday English words, 3 to 8 letters.
  var LIST = ('' +
    'the and for are but not you all any can had her was one our out day get has him his how man new now old see two way who boy did its let put say she too use ' +
    'that with have this will your from they know want been good much some time very when come here just like long make many more only over such take than them well were ' +
    'what year work back call came each even find give hand high keep last life look made most move must name need next open part play said same seem show side tell turn used ' +
    'word about after again water think where right great small large other place found house point study still world every never light might under while those three first sound ' +
    'little people before around should always follow things school mother father family friend number letter answer animal city country earth night river stone plant paper ' +
    'sleep tree rain wind fire snow star moon sun sea lake hill road path door wall room bed table chair window garden flower grass leaf seed fruit apple bread milk salt sugar ' +
    'tea cup plate spoon knife bowl soup rice meat fish egg cake pie ham jam nut bean pea corn pear plum lime mint ' +
    'cat dog pig cow hen duck bird horse sheep goat mouse lion bear wolf fox deer frog snake ant bee fly worm ' +
    'red blue green pink black white brown gold silver grey ' +
    'one two three four five six seven eight nine ten zero ' +
    'hat cap coat shirt shoe sock boot belt ring bag box pen pencil book page map ' +
    'run walk jump swim read write sing dance laugh smile listen learn teach speak talk help wait ' +
    'happy sunny rainy windy warm cool cold hot wet dry soft hard fast slow loud quiet tall short ' +
    'mum dad son baby uncle aunt sister brother ' +
    'time life love home hope idea part team game song story dream night morning evening ' +
    'plane train boat ship bus car truck bike wheel engine ' +
    'radio phone signal message wire power battery tower antenna ' +
    'north south east west up down left right near far ' +
    'ear eye nose mouth arm leg foot head heart hair face ' +
    'sit stand lie rest stop start end ' +
    'tell ask answer name state team sample master mister tester listen silent senile' +
    'able acid aged also area army away baby bank base bath bear beat belt best bill bird bite blow boat body bone book born both busy cake call calm camp card care case cash cast cell chat chip city clay club coal coat code cold come cook cool copy cost crew crop dark data date dawn dead deal dear deep dish door down draw drop drum duty dust easy edge else face fact fail fair fall farm fast fear feel feet fell file fill film fine firm five flag flat flow food fool form four free full fund gain game gate gave gift girl glad goal gone grew grow hair half hall hang hard harm hate head heal hear heat held help here hide hill hold hole holy home hope host hour huge hung hunt hurt idea inch into iron item join joke jump keen kept kick kill kind king knee knew know lack lady laid lake land lane late lawn lazy lead lean leap less line link list live load loan lock lone look lord lose loss lost lots loud luck mail main male many mark mass meal mean meat meet melt menu mere mess mild mile milk mind mine miss mode mood moon more most much must nail near neat neck need nest news nice nine node none noon nose note once only onto pace pack page paid pain pair pale palm park part pass past path peak pick pile pine pink pipe plan plot plug plus poem pole pool poor port post pour pray pull pure push quit race rail rain rank rare rate read real rent rest rich ride ring rise risk road rock role roll roof room root rope rose rule rush safe sail sale salt sand save seat seed seek seem seen self sell send sent ship shop shot shut sick sign silk sing sink site size skin slip slow snap soft soil sold some song soon sort soul spin spot stay stem step stir stop such suit sure swim tail tale talk tall tape task team tear tell tend term test text than then thin this thus tide tidy tile till time tiny tire told tone took tool tops tour town trap tree trip true tube tune turn twin type unit upon urge used vain vary vast very view vote wage wait wake walk wall want warm warn wash wave weak wear week well went west what when wide wife wild will wind wine wing wire wise wish wood wore work worm yard yarn year zone ' +
    'alarm alert alive alone angle apart apple arise array aside audio avoid award aware basic beach begin being below bench birth black blade blame blank blind block blood board bonus brain brand bread break brick brief bring broad brown build burst cable carry catch cause chain chair chart check chest chief child civil claim class clean clear clerk click climb clock close cloud coach coast count court cover craft crash cream cross crowd crown daily dance depth dirty doubt dozen draft drama dream dress drink drive early eight elite empty enemy enjoy enter entry equal error event exact exist extra faith false fault field fifth fight final first flame flash fleet floor fluid focus force frame fresh front fruit funny giant given glass globe grace grade grain grand grant grass great green group guard guess guest guide happy heart heavy honey horse hotel house human ideal image index inner input issue joint judge juice knife known label large laser later laugh layer learn least leave legal level light limit local logic loose lucky lunch major maker march match maybe mayor media metal meter might minor minus model money month moral motor mount mouse mouth movie music nerve never newly noise north novel nurse ocean offer often onion opera orbit order other paint panel paper party pause peace phase phone photo piano piece pilot pitch place plain plane plant plate point pound power press price pride prime print prior prize proof proud prove queen quick quiet radio raise range rapid ratio reach ready refer relax reply rider right rival river robot rough round route royal rural scale scene scope score sense serve seven shade shake shall shape share sharp sheep sheet shelf shell shift shine shirt shock shoot short shown sight silly since sixth sixty skill sleep slide small smart smile smoke snake solid solve sorry sound south space spare speak speed spend spent split spoke sport staff stage stair stamp stand start state steam steel stick still stock stone stood store storm story strip stuck study stuff style sugar suite super sweet swing table taken taste teach thank their theme there these thick thing think third those three threw throw tight timer tired title today token total touch tough tower track trade trail train treat trend trial tribe trick tried truck truly trust truth twice uncle under union unity until upper upset urban usage usual valid value video visit vital voice waste watch water wheel where which while white whole whose woman world worry worse worst worth would wound write wrong youth ' +
    'animal answer around author autumn basket beauty become before behind better beyond bridge broken button camera candle carpet castle center chance change charge cheese choice church circle closer coffee column common corner couple course cousin credit custom dancer danger decide degree design desire detail dinner doctor dollar double dragon during easily effect eleven empire enough entire escape expect family farmer father figure finger finish flight flower follow forest forget formal friend future garden gather gentle ground growth guitar handle happen health heaven height hidden hockey honest hunter indeed inside island itself jacket jungle kitchen ladder launch leader league lesson letter listen little living lonely market master matter member method middle minute mirror modern moment mother mostly motion museum narrow nation nature nearby needle nobody normal notice number object office online orange origin outer palace parent partly people period person planet player please pocket police polite potato prayer pretty prince prison public purple rabbit reason record remain remote repair repeat report rescue result return reveal ribbon rocket rubber saddle safety sailor salmon school screen season second secret select senior series server settle shadow shower silent silver simple single sister sketch smooth soccer social spirit spring square stable steady stream street stress strike string strong studio sudden summer sunset supply surface switch symbol system tablet target temple tender thirty thread throat ticket tiger timber tomato tongue travel tunnel twelve twenty unique unless urgent useful valley vessel victory village visitor volume wander warmth wealth weapon weekly weight window winter wisdom wonder wooden worker yellow' +
    '').split(/\s+/).filter(Boolean);

  var UNIQUE = (function () {
    var seen = {};
    return LIST.map(function (w) { return w.toUpperCase(); }).filter(function (w) {
      if (seen[w] || !/^[A-Z]{3,8}$/.test(w)) return false;
      seen[w] = true;
      return true;
    });
  })();

  function usable(word, allowed) {
    for (var i = 0; i < word.length; i++) if (allowed.indexOf(word.charAt(i)) < 0) return false;
    return true;
  }

  /** Words (built-in plus the learner's own) that use only `allowed` characters. */
  function matching(allowed, custom) {
    var extra = (custom || []).map(function (w) { return String(w).toUpperCase().replace(/[^A-Z0-9]/g, ''); }).filter(Boolean);
    var out = UNIQUE.concat(extra).filter(function (w) { return usable(w, allowed); });
    return out.filter(function (w, i) { return out.indexOf(w) === i; });
  }

  /** Random group of `len` characters from the pool, never repeating a character back to back. Always terminates. */
  function group(allowed, len, rng) {
    rng = rng || Math.random;
    var out = '';
    while (out.length < len) {
      var i = Math.floor(rng() * allowed.length) % allowed.length;
      var c = allowed[i];
      if (allowed.length > 1 && c === out.charAt(out.length - 1)) c = allowed[(i + 1) % allowed.length];
      out += c;
    }
    return out;
  }

  var MIN_WORDS = 8;

  /**
   * Next thing to copy. Returns {text, kind: 'word' | 'group'}.
   * Uses real words when there are enough; otherwise 4-letter groups, so early practice still works.
   */
  function next(allowed, rng, last, custom) {
    rng = rng || Math.random;
    var list = matching(allowed, custom);
    if (list.length >= MIN_WORDS) {
      var pool = list.filter(function (w) { return w !== last; });
      return { text: pool[Math.floor(rng() * pool.length)], kind: 'word' };
    }
    var g = group(allowed, 4, rng);
    for (var tries = 0; g === last && tries < 10; tries++) g = group(allowed, 4, rng);
    return { text: g, kind: 'group' };
  }

  function clean(text) { return String(text || '').toUpperCase().replace(/[^A-Z0-9.,?\/]/g, ''); }

  /** Compare an answer with the target, position by position. */
  function compare(target, answer) {
    target = clean(target);
    answer = clean(answer);
    var letters = [];
    for (var i = 0; i < Math.max(target.length, answer.length); i++) {
      letters.push({ want: target.charAt(i), got: answer.charAt(i), ok: target.charAt(i) === answer.charAt(i) });
    }
    return { ok: target === answer && target.length > 0, target: target, answer: answer, letters: letters };
  }

  return { LIST: UNIQUE, MIN_WORDS: MIN_WORDS, matching: matching, group: group, next: next, compare: compare, clean: clean,
    usable: usable };
});
