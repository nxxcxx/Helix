(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		// todo dont put exisiting item in db
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('info', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('info', 'searchById => DB:', res.data);
			if (res.data) {
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('info', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('info', 'searchById => cache:', cachedItem);
			return cachedItem;
		}

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http({
			method: 'GET',
			cache: true,
			url: TMDB_API.url + 'search/movie',
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			prevResultLen = searchResult.length;
			log.debug('info', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					movieIdCache.put(item.id, item);
					// putItemToDB( item ); // todo check if already exits in DB
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		prevResultLen = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		prevResultLen: prevResultLen,
		putItemToDB: putItemToDB
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['ENDPOINT_URI', '$http', '$q', 'authToken', function (ENDPOINT_URI, $http, $q, authToken) {

	var identity = null;
	var _identityResolved = false;

	function authorize(force) {

		var deferred = $q.defer();

		if (force) identity = null;

		if (identity !== null) {

			deferred.resolve();
		} else {

			$http.get(ENDPOINT_URI + 'auth').then(function (res) {

				console.log(res);
				identity = res.data;
				deferred.resolve();
				_identityResolved = true;
			}, function (err) {

				console.warn(err);
				// todo if jwt expired , deauthorize, remove local storage, redirect
				deferred.reject(err);
				_identityResolved = true;
			});
		}

		return deferred.promise;
	}

	function deauthorize() {
		// when logout
		authToken.removeToken();
		identity = null;
	}

	function isAuthenticated() {
		return identity !== null;
	}

	function identityResolved() {
		return _identityResolved;
	}

	return {

		authorize: authorize,
		deauthorize: deauthorize,
		isAuthenticated: isAuthenticated,
		identityResolved: identityResolved

	};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		var token = authToken.getToken();
		if (token) {
			// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
			// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
			// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
			config.headers.Authorization = 'Bearer ' + token;
		}
		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		console.log('token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['$scope', 'auth', function ($scope, auth) {}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function ($scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			console.log('email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			console.log(res);
			authToken.setToken(res.data.token);
			$state.go('private');
		}, function (err, status) {
			console.warn(err);
		});
	};
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', function ($state, auth) {

	auth.deauthorize();
	$state.go('signin');
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function ($scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			console.log('email & password required.');
			return;
		}

		console.log('Registering...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			console.log('Registered.');
			console.log(res);
			// login
			authToken.setToken(res.data.token);
			$state.go('private');
		}, function (err) {

			console.warn(err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, slicedArgs);
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		}

	};

	return EVT;
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $window.innerWidth,
		height: $window.innerHeight,
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $window.innerWidth;
		$$.height = $window.innerHeight;
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = ['$state', function ($state) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js

		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('privateCtrl', require('./auth/private.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('home', {
		url: '/',
		templateUrl: './template/home.html'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movie.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('private', {
		url: '/private',
		templateUrl: './template/private.html',
		controller: 'privateCtrl',
		controllerAs: 'private',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}]
		}
	});

	$httpProvider.interceptors.push('authInterceptor');
}]).run(['$rootScope', '$state', 'auth', function ($rootScope, $state, auth) {

	// todo authorize user every beginning of session
	// or just check if hasToken?
	auth.authorize(true);

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		console.log(error);
		if (error) {
			$state.go('signin');
		}
	});
}]).config(['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace('info', 'err'); // ctrl

	$httpProvider.useLegacyPromiseExtensions(false);
}]);

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/private.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./debug/log.pv.js":9,"./events.fac.js":10,"./helix/display.dir.js":11,"./helix/engine.fac.js":12,"./helix/helix.fac.js":13,"./helix/poster.dir.js":14,"./main.ctrl.js":16,"./movieDetail.ctrl.js":17,"./util.js":18}],16:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', function (log, $scope, TMDb, EVT, helix, ENGINE) {

	var vm = this;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(TMDb.prevResultLen), TMDb.prevResultLen);
	}, true);

	var prevQuery = '';
	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', function (log, $scope, TMDb, $cacheFactory, movieItem) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}
}];

},{}],18:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}]},{},[15])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3ByaXZhdGUuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ25vdXQuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9kZWJ1Zy9sb2cucHYuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL3V0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdBQUcsYUFBYSxDQUFFLGNBQWMsQ0FBRSxDQUFDOzs7QUFHbkQsS0FBSSxXQUFXLEdBQUcsWUFBWSxHQUFHLFFBQVEsQ0FBQzs7QUFFMUMsVUFBUyxXQUFXLENBQUUsU0FBUyxFQUFHOztBQUVqQyxPQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxTQUFTLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBRSxDQUNqRCxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDdkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2pDLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2hDLENBQUUsQ0FBQztFQUVKOztBQUVELFVBQVMsY0FBYyxDQUFFLEVBQUUsRUFBRztBQUM3QixNQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxFQUFFLENBQUUsQ0FDMUMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3ZCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLG1CQUFtQixFQUFFLEdBQUcsQ0FBQyxJQUFJLENBQUUsQ0FBQztBQUNuRCxPQUFLLEdBQUcsQ0FBQyxJQUFJLEVBQUc7QUFDZixXQUFPLEdBQUcsQ0FBQyxJQUFJLENBQUM7SUFDaEIsTUFBTTtBQUNOLFdBQU8sSUFBSSxDQUFDO0lBQ1o7R0FDRCxFQUFFLFVBQVUsR0FBRyxFQUFHO0FBQ2xCLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLG1CQUFtQixFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQzdDLENBQUUsQ0FBQztBQUNKLFNBQU8sT0FBTyxDQUFDO0VBQ2Y7O0FBRUQsVUFBUyxlQUFlLENBQUUsRUFBRSxFQUFHO0FBQzlCLE1BQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUUsUUFBUSxDQUFDLEdBQUcsR0FBRyxRQUFRLEdBQUcsRUFBRSxFQUFFO0FBQ3RELFNBQU0sRUFBRSxFQUFFLE9BQU8sRUFBRSxRQUFRLENBQUMsR0FBRyxFQUFFO0dBQ2pDLENBQUUsQ0FBQyxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDMUIsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsb0JBQW9CLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDO0FBQ3BELGVBQVksQ0FBQyxHQUFHLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDO0FBQzFDLGNBQVcsQ0FBRSxHQUFHLENBQUMsSUFBSSxDQUFFLENBQUM7QUFDeEIsVUFBTyxHQUFHLENBQUMsSUFBSSxDQUFDO0dBQ2hCLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxLQUFLLEVBQUUsb0JBQW9CLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDOUMsQ0FBRSxDQUFDO0FBQ0osU0FBTyxPQUFPLENBQUM7RUFDZjs7QUFFRCxVQUFTLFVBQVUsQ0FBRSxFQUFFLEVBQUc7O0FBRXpCLE1BQUksVUFBVSxHQUFHLFlBQVksQ0FBQyxHQUFHLENBQUUsRUFBRSxDQUFFLENBQUM7QUFDeEMsTUFBSyxVQUFVLEVBQUc7QUFDakIsTUFBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsc0JBQXNCLEVBQUUsVUFBVSxDQUFFLENBQUM7QUFDeEQsVUFBTyxVQUFVLENBQUM7R0FDbEI7O0FBRUQsTUFBSSxLQUFLLEdBQUcsRUFBRSxDQUFDLEtBQUssRUFBRSxDQUFDO0FBQ3ZCLE1BQUksTUFBTSxHQUFHLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQzs7QUFFeEIsZ0JBQWMsQ0FBRSxFQUFFLENBQUUsQ0FBQyxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDM0MsT0FBSyxHQUFHLEVBQUc7QUFDVixTQUFLLENBQUMsT0FBTyxDQUFFLEdBQUcsQ0FBRSxDQUFDO0lBQ3JCLE1BQU07QUFDTixTQUFLLENBQUMsTUFBTSxDQUFFLFdBQVcsQ0FBRSxDQUFDO0lBQzVCO0dBQ0QsRUFBRSxVQUFXLEdBQUcsRUFBRztBQUNsQixRQUFLLENBQUMsTUFBTSxDQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ3JCLENBQUUsQ0FBQzs7QUFFSixPQUFLLENBQUMsT0FBTyxDQUFDLElBQUksQ0FBRSxVQUFXLE1BQU0sRUFBRztBQUN2QyxTQUFNLENBQUMsT0FBTyxDQUFFLE1BQU0sQ0FBRSxDQUFDO0dBQ3pCLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbkIsa0JBQWUsQ0FBRSxFQUFFLENBQUUsQ0FBQyxJQUFJLENBQUUsVUFBVyxPQUFPLEVBQUc7QUFDaEQsVUFBTSxDQUFDLE9BQU8sQ0FBRSxPQUFPLENBQUUsQ0FBQztJQUMxQixFQUFFLFVBQVcsT0FBTyxFQUFHO0FBQ3ZCLFVBQU0sQ0FBQyxNQUFNLENBQUUsT0FBTyxDQUFFLENBQUM7SUFDekIsQ0FBRSxDQUFDO0dBQ0osQ0FBRSxDQUFDOztBQUVKLFNBQU8sTUFBTSxDQUFDLE9BQU8sQ0FBQztFQUV0Qjs7QUFFRCxVQUFTLGFBQWEsQ0FBRSxTQUFTLEVBQUc7O0FBRW5DLE1BQUssUUFBUSxHQUFHLFVBQVUsSUFBSSxVQUFVLEtBQUssQ0FBQyxDQUFDLEVBQUc7O0FBRWpELE1BQUcsQ0FBQyxHQUFHLENBQUMsSUFBSSxFQUFFLENBQUM7QUFDZixVQUFPO0dBQ1A7O0FBRUQsT0FBSyxDQUFFO0FBQ04sU0FBTSxFQUFFLEtBQUs7QUFDYixRQUFLLEVBQUUsSUFBSTtBQUNYLE1BQUcsRUFBRSxRQUFRLENBQUMsR0FBRyxHQUFHLGNBQWM7QUFDbEMsU0FBTSxFQUFDO0FBQ04sV0FBTyxFQUFFLFFBQVEsQ0FBQyxHQUFHO0FBQ3JCLFNBQUssRUFBRSxTQUFTLENBQUMsS0FBSztBQUN0QixRQUFJLEVBQUUsUUFBUTtJQUNkO0dBQ0QsQ0FBRSxDQUFDLElBQUksQ0FBRSxVQUFXLEdBQUcsRUFBRzs7QUFFMUIsZUFBWSxHQUFHLFlBQVksQ0FBQyxNQUFNLENBQUUsbUJBQW1CLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUUsQ0FBRSxDQUFDO0FBQzlFLGFBQVUsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztBQUNsQyxXQUFRLEVBQUcsQ0FBQztBQUNaLGdCQUFhLEdBQUcsWUFBWSxDQUFDLE1BQU0sQ0FBQztBQUNwQyxNQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSxHQUFHLEVBQUUsR0FBRyxDQUFDLElBQUksQ0FBRSxDQUFDOzs7QUFHbkMsTUFBRyxDQUFDLElBQUksQ0FBQyxPQUFPLENBQUMsT0FBTyxDQUFFLFVBQVcsSUFBSSxFQUFHOztBQUUzQyxRQUFLLENBQUMsWUFBWSxDQUFDLEdBQUcsQ0FBRSxJQUFJLENBQUMsRUFBRSxDQUFFLEVBQUc7QUFDbkMsaUJBQVksQ0FBQyxHQUFHLENBQUUsSUFBSSxDQUFDLEVBQUUsRUFBRSxJQUFJLENBQUUsQ0FBQzs7S0FFbEM7SUFFRCxDQUFFLENBQUM7R0FFSixFQUFFLFVBQVcsR0FBRyxFQUFHOztBQUVuQixNQUFHLENBQUMsS0FBSyxDQUFFLEtBQUssRUFBRSxHQUFHLENBQUUsQ0FBQztHQUN4QixDQUFFLENBQUM7RUFFSjs7QUFFRCxVQUFTLG1CQUFtQixDQUFFLE9BQU8sRUFBRztBQUN2QyxTQUFPLE9BQU8sQ0FBQyxNQUFNLENBQUUsVUFBVyxJQUFJLEVBQUc7QUFDeEMsVUFBTyxDQUFDLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQztHQUMxQixDQUFFLENBQUM7RUFDSjs7QUFFRCxVQUFTLE1BQU0sR0FBRztBQUNqQixTQUFPLFlBQVksQ0FBQztFQUNwQjs7QUFFRCxVQUFTLFdBQVcsR0FBRzs7QUFFdEIsY0FBWSxDQUFDLE1BQU0sR0FBRyxDQUFDLENBQUM7QUFDeEIsZUFBYSxHQUFHLENBQUMsQ0FBQztBQUNsQixZQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDaEIsVUFBUSxHQUFHLENBQUMsQ0FBQztFQUNiOztBQUVELFFBQU87QUFDTixlQUFhLEVBQWIsYUFBYTtBQUNiLFlBQVUsRUFBVixVQUFVO0FBQ1YsYUFBVyxFQUFYLFdBQVc7QUFDWCxRQUFNLEVBQU4sTUFBTTtBQUNOLGVBQWEsRUFBYixhQUFhO0FBQ2IsYUFBVyxFQUFYLFdBQVc7RUFDWCxDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQzdKSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsY0FBYyxFQUFFLE9BQU8sRUFBRSxJQUFJLEVBQUUsV0FBVyxFQUM3RCxVQUFXLFlBQVksRUFBRSxLQUFLLEVBQUUsRUFBRSxFQUFFLFNBQVMsRUFBRzs7QUFFOUMsS0FBSSxRQUFRLEdBQUcsSUFBSSxDQUFDO0FBQ3BCLEtBQUksaUJBQWlCLEdBQUcsS0FBSyxDQUFDOztBQUU5QixVQUFTLFNBQVMsQ0FBRSxLQUFLLEVBQUc7O0FBRTNCLE1BQUksUUFBUSxHQUFHLEVBQUUsQ0FBQyxLQUFLLEVBQUUsQ0FBQzs7QUFFMUIsTUFBSyxLQUFLLEVBQUcsUUFBUSxHQUFHLElBQUksQ0FBQzs7QUFFN0IsTUFBSyxRQUFRLEtBQUssSUFBSSxFQUFHOztBQUV4QixXQUFRLENBQUMsT0FBTyxFQUFFLENBQUM7R0FFbkIsTUFBTTs7QUFFTixRQUFLLENBQUMsR0FBRyxDQUFFLFlBQVksR0FBRyxNQUFNLENBQUUsQ0FDaEMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHOztBQUV2QixXQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBRSxDQUFDO0FBQ25CLFlBQVEsR0FBRyxHQUFHLENBQUMsSUFBSSxDQUFDO0FBQ3BCLFlBQVEsQ0FBQyxPQUFPLEVBQUUsQ0FBQztBQUNuQixxQkFBaUIsR0FBRyxJQUFJLENBQUM7SUFFekIsRUFBRSxVQUFXLEdBQUcsRUFBRzs7QUFFbkIsV0FBTyxDQUFDLElBQUksQ0FBRSxHQUFHLENBQUUsQ0FBQzs7QUFFcEIsWUFBUSxDQUFDLE1BQU0sQ0FBRSxHQUFHLENBQUUsQ0FBQztBQUN2QixxQkFBaUIsR0FBRyxJQUFJLENBQUM7SUFFekIsQ0FBRSxDQUFDO0dBRUw7O0FBRUQsU0FBTyxRQUFRLENBQUMsT0FBTyxDQUFDO0VBRXhCOztBQUVELFVBQVMsV0FBVyxHQUFHOztBQUV0QixXQUFTLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDeEIsVUFBUSxHQUFHLElBQUksQ0FBQztFQUNoQjs7QUFFRCxVQUFTLGVBQWUsR0FBRztBQUMxQixTQUFPLFFBQVEsS0FBSyxJQUFJLENBQUM7RUFDekI7O0FBRUQsVUFBUyxnQkFBZ0IsR0FBRztBQUMzQixTQUFPLGlCQUFpQixDQUFDO0VBQ3pCOztBQUVELFFBQU87O0FBRU4sV0FBUyxFQUFULFNBQVM7QUFDVCxhQUFXLEVBQVgsV0FBVztBQUNYLGlCQUFlLEVBQWYsZUFBZTtBQUNmLGtCQUFnQixFQUFoQixnQkFBZ0I7O0VBRWhCLENBQUM7Q0FFSCxDQUFFLENBQUM7Ozs7O0FDaEVKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxXQUFXLEVBQUUsVUFBVyxTQUFTLEVBQUc7O0FBRXRELFVBQVMsT0FBTyxDQUFFLE1BQU0sRUFBRzs7QUFFMUIsTUFBSSxLQUFLLEdBQUcsU0FBUyxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBQ2pDLE1BQUssS0FBSyxFQUFHOzs7O0FBSVosU0FBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhLEdBQUcsU0FBUyxHQUFHLEtBQUssQ0FBQztHQUNqRDtBQUNELFNBQU8sTUFBTSxDQUFDO0VBRWQ7O0FBRUQsVUFBUyxRQUFRLENBQUUsR0FBRyxFQUFHO0FBQ3hCLFNBQU8sR0FBRyxDQUFDO0VBQ1g7O0FBRUQsUUFBTzs7QUFFTixTQUFPLEVBQVAsT0FBTztBQUNQLFVBQVEsRUFBUixRQUFROztFQUVSLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDMUJKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxTQUFTLEVBQUUsVUFBVyxPQUFPLEVBQUc7O0FBRWxELEtBQUksT0FBTyxHQUFHLE9BQU8sQ0FBQyxZQUFZLENBQUM7QUFDbkMsS0FBSSxXQUFXLEdBQUcsSUFBSSxDQUFDOztBQUV2QixVQUFTLFFBQVEsQ0FBRSxLQUFLLEVBQUc7QUFDMUIsYUFBVyxHQUFHLEtBQUssQ0FBQztBQUNwQixTQUFPLENBQUMsT0FBTyxDQUFFLEtBQUssRUFBRSxLQUFLLENBQUUsQ0FBQztFQUNoQzs7QUFFRCxVQUFTLFFBQVEsR0FBRztBQUNuQixNQUFLLENBQUMsV0FBVyxFQUFHO0FBQ25CLGNBQVcsR0FBRyxPQUFPLENBQUMsT0FBTyxDQUFFLEtBQUssQ0FBRSxDQUFDO0dBQ3ZDO0FBQ0QsU0FBTyxXQUFXLENBQUM7RUFDbkI7O0FBRUQsVUFBUyxXQUFXLEdBQUc7QUFDdEIsYUFBVyxHQUFHLElBQUksQ0FBQztBQUNuQixTQUFPLENBQUMsVUFBVSxDQUFFLEtBQUssQ0FBRSxDQUFDO0FBQzVCLFNBQU8sQ0FBQyxHQUFHLENBQUUsZUFBZSxDQUFFLENBQUM7RUFDL0I7O0FBRUQsVUFBUyxRQUFRLEdBQUc7QUFDbkIsU0FBTyxDQUFDLENBQUMsUUFBUSxFQUFFLENBQUM7RUFDcEI7O0FBRUQsUUFBTzs7QUFFTixVQUFRLEVBQVIsUUFBUTtBQUNSLFVBQVEsRUFBUixRQUFRO0FBQ1IsYUFBVyxFQUFYLFdBQVc7QUFDWCxVQUFRLEVBQVIsUUFBUTs7RUFFUixDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQ3BDSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsUUFBUSxFQUFFLE1BQU0sRUFBRSxVQUFXLE1BQU0sRUFBRSxJQUFJLEVBQUksRUFFL0QsQ0FBRSxDQUFDOzs7OztBQ0ZKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxRQUFRLEVBQUUsT0FBTyxFQUFFLGNBQWMsRUFBRSxXQUFXLEVBQUUsUUFBUSxFQUMzRSxVQUFXLE1BQU0sRUFBRSxLQUFLLEVBQUUsWUFBWSxFQUFFLFNBQVMsRUFBRSxNQUFNLEVBQUk7O0FBRTVELEtBQUksRUFBRSxHQUFHLElBQUksQ0FBQztBQUNkLEdBQUUsQ0FBQyxJQUFJLEdBQUc7QUFDVCxPQUFLLEVBQUUsRUFBRTtBQUNULFVBQVEsRUFBRSxFQUFFO0VBQ1osQ0FBQzs7QUFFRixHQUFFLENBQUMsTUFBTSxHQUFHLFlBQVc7O0FBRXRCLE1BQUssRUFBRSxDQUFDLElBQUksQ0FBQyxLQUFLLEtBQUssRUFBRSxJQUFJLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxLQUFLLEVBQUUsRUFBRztBQUN0RCxVQUFPLENBQUMsR0FBRyxDQUFFLDRCQUE0QixDQUFFLENBQUM7QUFDNUMsVUFBTztHQUNQOztBQUVELE9BQUssQ0FBQyxJQUFJLENBQUUsWUFBWSxHQUFHLFFBQVEsRUFBRSxFQUFFLENBQUMsSUFBSSxDQUFFLENBQzVDLElBQUksQ0FBRSxVQUFVLEdBQUcsRUFBRztBQUN0QixVQUFPLENBQUMsR0FBRyxDQUFFLEdBQUcsQ0FBRSxDQUFDO0FBQ25CLFlBQVMsQ0FBQyxRQUFRLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUUsQ0FBQztBQUNyQyxTQUFNLENBQUMsRUFBRSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0dBQ3ZCLEVBQUUsVUFBVSxHQUFHLEVBQUUsTUFBTSxFQUFHO0FBQzFCLFVBQU8sQ0FBQyxJQUFJLENBQUUsR0FBRyxDQUFFLENBQUM7R0FDcEIsQ0FBRSxDQUFDO0VBRUwsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUMzQkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsVUFBVyxNQUFNLEVBQUUsSUFBSSxFQUFJOztBQUUvRCxLQUFJLENBQUMsV0FBVyxFQUFFLENBQUM7QUFDbkIsT0FBTSxDQUFDLEVBQUUsQ0FBRSxRQUFRLENBQUUsQ0FBQztDQUV0QixDQUFFLENBQUM7Ozs7O0FDTEosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFFBQVEsRUFBRSxPQUFPLEVBQUUsY0FBYyxFQUFFLFdBQVcsRUFBRSxRQUFRLEVBQzNFLFVBQVcsTUFBTSxFQUFFLEtBQUssRUFBRSxZQUFZLEVBQUUsU0FBUyxFQUFFLE1BQU0sRUFBRzs7QUFFMUQsS0FBSSxFQUFFLEdBQUcsSUFBSSxDQUFDO0FBQ2QsR0FBRSxDQUFDLElBQUksR0FBRyxFQUFFLENBQUM7O0FBRWIsR0FBRSxDQUFDLE1BQU0sR0FBRyxZQUFZOztBQUV2QixNQUFLLEVBQUUsQ0FBQyxJQUFJLENBQUMsS0FBSyxLQUFLLFNBQVMsSUFBSSxFQUFFLENBQUMsSUFBSSxDQUFDLFFBQVEsS0FBSyxTQUFTLEVBQUc7QUFDcEUsVUFBTyxDQUFDLEdBQUcsQ0FBRSw0QkFBNEIsQ0FBRSxDQUFDO0FBQzVDLFVBQU87R0FDUDs7QUFFRCxTQUFPLENBQUMsR0FBRyxDQUFFLGdCQUFnQixDQUFFLENBQUM7QUFDaEMsT0FBSyxDQUFDLElBQUksQ0FBRSxZQUFZLEdBQUcsUUFBUSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUUsQ0FDNUMsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHOztBQUV2QixVQUFPLENBQUMsR0FBRyxDQUFFLGFBQWEsQ0FBRSxDQUFDO0FBQzdCLFVBQU8sQ0FBQyxHQUFHLENBQUUsR0FBRyxDQUFFLENBQUM7O0FBRW5CLFlBQVMsQ0FBQyxRQUFRLENBQUUsR0FBRyxDQUFDLElBQUksQ0FBQyxLQUFLLENBQUUsQ0FBQztBQUNyQyxTQUFNLENBQUMsRUFBRSxDQUFFLFNBQVMsQ0FBRSxDQUFDO0dBRXZCLEVBQUUsVUFBVyxHQUFHLEVBQUc7O0FBRW5CLFVBQU8sQ0FBQyxJQUFJLENBQUUsR0FBRyxDQUFFLENBQUM7QUFDcEIsS0FBRSxDQUFDLElBQUksQ0FBQyxVQUFVLEdBQUcsS0FBSyxDQUFDO0dBRTNCLENBQUUsQ0FBQztFQUVMLENBQUM7Q0FFSCxDQUFFLENBQUM7Ozs7O0FDaENKLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxZQUFZOztBQUU5QixLQUFJLFlBQVksR0FBRyxLQUFLLENBQUM7QUFDekIsS0FBSSxlQUFlLEdBQUcsRUFBRSxDQUFDOztBQUV6QixLQUFJLENBQUMsV0FBVyxHQUFHLFlBQVk7QUFDOUIsY0FBWSxHQUFHLElBQUksQ0FBQztFQUNwQixDQUFDOztBQUVGLEtBQUksQ0FBQyxvQkFBb0IsR0FBRyxZQUFZO0FBQ3ZDLE9BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxTQUFTLENBQUMsTUFBTSxFQUFFLENBQUMsRUFBRSxFQUFHO0FBQzVDLGtCQUFlLENBQUMsSUFBSSxDQUFFLFNBQVMsQ0FBRSxDQUFDLENBQUUsQ0FBRSxDQUFDO0dBQ3ZDO0VBQ0QsQ0FBQzs7QUFFRixLQUFJLENBQUMsSUFBSSxHQUFHLFlBQU07O0FBRWpCLFdBQVMsS0FBSyxHQUFHO0FBQ2hCLE9BQUssQ0FBQyxZQUFZLEVBQUcsT0FBTztBQUM1QixPQUFJLFNBQVMsR0FBRyxTQUFTLENBQUUsQ0FBQyxDQUFFLENBQUM7QUFDL0IsT0FBSSxVQUFVLEdBQUcsS0FBSyxDQUFDLFNBQVMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFFLFNBQVMsRUFBRSxDQUFDLENBQUUsQ0FBQztBQUM1RCxPQUFLLFNBQVMsS0FBSyxLQUFLLEVBQUc7QUFDMUIsV0FBTyxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLFVBQVUsQ0FBRSxDQUFDO0lBQzNDLE1BQU0sSUFBSyxTQUFTLEtBQUssTUFBTSxFQUFHO0FBQ2xDLFdBQU8sQ0FBQyxJQUFJLENBQUMsS0FBSyxDQUFFLE9BQU8sRUFBRSxVQUFVLENBQUUsQ0FBQztJQUMxQyxNQUFNLElBQUssZUFBZSxDQUFDLE9BQU8sQ0FBRSxTQUFTLENBQUUsS0FBSyxDQUFDLENBQUMsRUFBRztBQUN6RCxXQUFPLENBQUMsR0FBRyxDQUFDLEtBQUssQ0FBRSxPQUFPLEVBQUUsVUFBVSxDQUFFLENBQUM7SUFDekM7R0FDRDs7QUFFRCxTQUFPO0FBQ04sUUFBSyxFQUFMLEtBQUs7R0FDTCxDQUFDO0VBRUYsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUNwQ0osTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFlBQVksRUFBRSxVQUFXLFVBQVUsRUFBRzs7QUFFeEQsS0FBSSxHQUFHLEdBQUc7O0FBRVQsS0FBRyxFQUFFO0FBQ0osU0FBTSxFQUFFLGdCQUFXLEVBQUUsRUFBRztBQUFFLGNBQVUsQ0FBQyxHQUFHLENBQUUsS0FBSyxFQUFFLEVBQUUsQ0FBRSxDQUFDO0lBQUU7QUFDeEQsT0FBSSxFQUFFLGdCQUFZO0FBQUUsY0FBVSxDQUFDLFVBQVUsQ0FBRSxLQUFLLENBQUUsQ0FBQztJQUFFO0dBQ3JEOztFQUVELENBQUM7O0FBRUYsUUFBTyxHQUFHLENBQUM7Q0FFWCxDQUFFLENBQUM7Ozs7O0FDYkosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLFVBQVcsT0FBTyxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUc7O0FBRWxGLFVBQVMsSUFBSSxDQUFFLE1BQU0sRUFBRSxRQUFRLEVBQUc7O0FBRWpDLFFBQU0sQ0FBQyxjQUFjLENBQUUsUUFBUSxDQUFFLENBQUM7QUFDbEMsR0FBQyxDQUFFLE9BQU8sQ0FBRSxDQUFDLEVBQUUsQ0FBRSxRQUFRLEVBQUUsSUFBSSxDQUFDLFFBQVEsQ0FBRSxNQUFNLENBQUMsY0FBYyxFQUFFLEdBQUcsQ0FBRSxDQUFFLENBQUE7QUFDeEUsVUFBUSxDQUFDLEVBQUUsQ0FBRSxPQUFPLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDdEMsU0FBTSxDQUFDLEVBQUUsQ0FBQyxRQUFRLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxDQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsTUFBTSxDQUFFLENBQUM7R0FDNUQsQ0FBRSxDQUFDOztBQUVKLFFBQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztFQUVmOztBQUVELFFBQU87QUFDTixVQUFRLEVBQUUsR0FBRztBQUNiLFNBQU8sRUFBRSxJQUFJO0FBQ2IsWUFBVSxFQUFFLElBQUk7QUFDaEIsVUFBUSxFQUFFLG1DQUFtQztFQUM3QyxDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQ3JCSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsU0FBUyxFQUFFLFVBQVcsT0FBTyxFQUFHOztBQUVsRCxLQUFJLEVBQUUsR0FBRztBQUNSLFFBQU0sRUFBRSxJQUFJO0FBQ1osT0FBSyxFQUFFLElBQUksS0FBSyxFQUFFO0FBQ2xCLE9BQUssRUFBRSxJQUFJLEtBQUssQ0FBQyxLQUFLLEVBQUU7QUFDeEIsT0FBSyxFQUFFLE9BQU8sQ0FBQyxVQUFVO0FBQ3pCLFFBQU0sRUFBRSxPQUFPLENBQUMsV0FBVztBQUMzQixRQUFNLEVBQUUsSUFBSSxLQUFLLENBQUMsaUJBQWlCLENBQUUsRUFBRSxFQUFFLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU0sRUFBRSxFQUFFLEVBQUUsTUFBTSxDQUFFO0FBQy9FLFVBQVEsRUFBRSxJQUFJLEtBQUssQ0FBQyxhQUFhLEVBQUU7QUFDbkMsY0FBWSxFQUFFLElBQUksQ0FBQyxLQUFLLEdBQUcsSUFBSSxDQUFDLE1BQU07QUFDdEMsYUFBVyxFQUFFLE9BQU8sQ0FBQyxnQkFBZ0IsSUFBSSxDQUFDO0FBQzFDLFNBQU8sRUFBRSxJQUFJLENBQUMsS0FBSyxHQUFHLEdBQUc7QUFDekIsU0FBTyxFQUFFLElBQUksQ0FBQyxNQUFNLEdBQUcsR0FBRztBQUMxQixVQUFRLEVBQUUsQ0FBQztFQUNYLENBQUM7O0FBRUYsR0FBRSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUUsRUFBRSxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsTUFBTSxDQUFFLENBQUM7O0FBRTNDLFVBQVMsY0FBYyxDQUFFLE1BQU0sRUFBRztBQUNqQyxJQUFFLENBQUMsTUFBTSxHQUFHLE1BQU0sQ0FBQztBQUNuQixRQUFNLENBQUMsTUFBTSxDQUFFLEVBQUUsQ0FBQyxRQUFRLENBQUMsVUFBVSxDQUFFLENBQUM7QUFDeEMsUUFBTSxDQUFDLE1BQU0sQ0FBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFVBQVUsQ0FBRSxDQUFDO0VBQ3JDOztBQUVELFVBQVMsY0FBYyxHQUFHO0FBQ3pCLElBQUUsQ0FBQyxLQUFLLEdBQUcsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixJQUFFLENBQUMsTUFBTSxHQUFHLE9BQU8sQ0FBQyxXQUFXLENBQUM7QUFDaEMsSUFBRSxDQUFDLFdBQVcsR0FBRyxPQUFPLENBQUMsZ0JBQWdCLElBQUksQ0FBQyxDQUFDO0FBQy9DLElBQUUsQ0FBQyxZQUFZLEdBQUcsRUFBRSxDQUFDLEtBQUssR0FBRyxFQUFFLENBQUMsTUFBTSxDQUFDO0FBQ3ZDLElBQUUsQ0FBQyxNQUFNLENBQUMsTUFBTSxHQUFHLEVBQUUsQ0FBQyxZQUFZLENBQUM7QUFDbkMsSUFBRSxDQUFDLE1BQU0sQ0FBQyxzQkFBc0IsRUFBRSxDQUFDO0FBQ25DLElBQUUsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBRSxDQUFDO0VBQzNDOztBQUVELFVBQVMsS0FBSyxHQUFHLEVBRWhCOztBQUVELFVBQVMsTUFBTSxHQUFHOztBQUVqQixNQUFLLElBQUksQ0FBQyxHQUFHLENBQUUsRUFBRSxDQUFDLFFBQVEsQ0FBRSxHQUFHLEtBQUssRUFBRztBQUN0QyxLQUFFLENBQUMsTUFBTSxDQUFDLFFBQVEsQ0FBQyxDQUFDLElBQUksRUFBRSxDQUFDLFFBQVEsR0FBRyxHQUFHLENBQUM7QUFDMUMsS0FBRSxDQUFDLE1BQU0sQ0FBQyxPQUFPLENBQUUsRUFBRSxDQUFDLFFBQVEsR0FBRyxLQUFLLENBQUUsQ0FBQztBQUN6QyxLQUFFLENBQUMsUUFBUSxJQUFJLElBQUksQ0FBQztHQUNwQjtFQUVEOzs7QUFHRCxVQUFTLEdBQUcsR0FBRzs7QUFFZCx1QkFBcUIsQ0FBRSxHQUFHLENBQUUsQ0FBQztBQUM3QixRQUFNLEVBQUUsQ0FBQztBQUNULElBQUUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFFLEVBQUUsQ0FBQyxLQUFLLEVBQUUsRUFBRSxDQUFDLE1BQU0sQ0FBRSxDQUFDO0FBQzFDLElBQUUsQ0FBQyxLQUFLLENBQUMsTUFBTSxFQUFFLENBQUM7RUFFbEI7O0FBRUQsVUFBUyxLQUFLLEdBQUc7QUFDaEIsT0FBSyxFQUFFLENBQUM7QUFDUixLQUFHLEVBQUUsQ0FBQztFQUNOOztBQUVELFVBQVMsV0FBVyxHQUFHO0FBQ3RCLElBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDO0FBQ2xDLElBQUUsQ0FBQyxNQUFNLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBRSxDQUFDLEVBQUUsQ0FBQyxFQUFFLENBQUMsQ0FBRSxDQUFDO0VBQ2xDOztBQUVELFFBQU87QUFDTixJQUFFLEVBQUYsRUFBRTtBQUNGLGdCQUFjLEVBQWQsY0FBYztBQUNkLGdCQUFjLEVBQWQsY0FBYztBQUNkLE9BQUssRUFBTCxLQUFLO0FBQ0wsYUFBVyxFQUFYLFdBQVc7RUFDWCxDQUFDO0NBRUYsQ0FBRSxDQUFDOzs7OztBQzdFSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxVQUFVLEVBQUUsWUFBWSxFQUM1RCxVQUFXLEdBQUcsRUFBRSxNQUFNLEVBQUUsUUFBUSxFQUFFLFVBQVUsRUFBRzs7QUFFOUMsS0FBSSxVQUFVLEdBQUcsSUFBSSxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7QUFDdEMsT0FBTSxDQUFDLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFFLFVBQVUsQ0FBRSxDQUFDOztBQUVsQyxVQUFTLGdCQUFnQixDQUFFLGlCQUFpQixFQUFFLGNBQWMsRUFBRzs7QUFFOUQsTUFBSSxNQUFNLEdBQUcsSUFBSSxLQUFLLENBQUMsT0FBTyxFQUFFLENBQUM7QUFDakMsTUFBSSxNQUFNLEdBQUcsR0FBRyxDQUFDO0FBQ2pCLE9BQU0sSUFBSSxDQUFDLEdBQUcsQ0FBQyxFQUFFLENBQUMsR0FBRyxpQkFBaUIsQ0FBQyxNQUFNLEVBQUUsQ0FBQyxFQUFFLEVBQUc7O0FBRXBELE9BQUksY0FBYyxHQUFHLFVBQVUsQ0FBQyxJQUFJLENBQUUsSUFBSSxDQUFFLENBQUM7QUFDN0MsaUJBQWMsQ0FBQyxTQUFTLEdBQUcsaUJBQWlCLENBQUUsQ0FBQyxDQUFFLENBQUM7O0FBRWxELE9BQUksbUJBQW1CLEdBQUcsUUFBUSxDQUFFLG1CQUFtQixDQUFFLENBQUUsY0FBYyxDQUFFLENBQUUsQ0FBQyxDQUFFLENBQUM7QUFDakYsT0FBSSxRQUFRLEdBQUcsSUFBSSxLQUFLLENBQUMsV0FBVyxDQUFFLG1CQUFtQixDQUFFLENBQUM7OztBQUc1RCxXQUFRLENBQUMsS0FBSyxHQUFHLGNBQWMsQ0FBQzs7QUFFaEMsT0FBSSxJQUFJLEdBQUcsQ0FBQyxHQUFHLGNBQWMsQ0FBQztBQUM5QixPQUFJLEdBQUcsR0FBRyxJQUFJLEdBQUcsS0FBSyxHQUFHLElBQUksQ0FBQyxFQUFFLENBQUM7QUFDakMsV0FBUSxDQUFDLFFBQVEsQ0FBQyxDQUFDLEdBQUcsQ0FBRSxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBRSxHQUFHLENBQUUsQ0FBQztBQUNqRCxXQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxFQUFJLElBQUksR0FBRyxDQUFDLENBQUEsQUFBRSxHQUFHLEdBQUcsQ0FBQztBQUMzQyxXQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsR0FBRyxNQUFNLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBRSxHQUFHLENBQUUsQ0FBQzs7QUFFL0MsU0FBTSxDQUFDLEdBQUcsQ0FBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsRUFBRSxRQUFRLENBQUMsUUFBUSxDQUFDLENBQUMsRUFBRSxDQUFDLFFBQVEsQ0FBQyxRQUFRLENBQUMsQ0FBQyxHQUFHLENBQUMsQ0FBRSxDQUFDOztBQUV0RixXQUFRLENBQUMsTUFBTSxDQUFFLE1BQU0sQ0FBRSxDQUFDO0FBQzFCLGFBQVUsQ0FBQyxHQUFHLENBQUUsUUFBUSxDQUFFLENBQUM7R0FFM0I7O0FBRUQsS0FBRyxDQUFDLEtBQUssQ0FBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLFVBQVUsQ0FBQyxRQUFRLENBQUMsTUFBTSxDQUFFLENBQUM7RUFFakU7O0FBRUQsVUFBUyxRQUFRLEdBQUc7QUFDbkIsWUFBVSxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUUsVUFBVyxNQUFNLEVBQUc7QUFDaEQsU0FBTSxDQUFDLGNBQWMsRUFBRSxDQUFDO0FBQ3hCLFNBQU0sQ0FBQyxLQUFLLENBQUMsUUFBUSxFQUFFLENBQUM7R0FDeEIsQ0FBRSxDQUFDO0FBQ0osWUFBVSxDQUFDLFFBQVEsQ0FBQyxNQUFNLEdBQUcsQ0FBQyxDQUFDO0VBQy9COztBQUVELFFBQU87QUFDTixrQkFBZ0IsRUFBaEIsZ0JBQWdCO0FBQ2hCLFVBQVEsRUFBUixRQUFRO0VBQ1IsQ0FBQztDQUVGLENBQUUsQ0FBQzs7Ozs7QUNuREosTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLFFBQVEsRUFBRSxVQUFXLE1BQU0sRUFBRzs7QUFFaEQsVUFBUyxJQUFJLENBQUUsTUFBTSxFQUFFLFFBQVEsRUFBRzs7OztBQUlqQyxNQUFJLEdBQUcsR0FBRyxJQUFJLEtBQUssRUFBRSxDQUFDO0FBQ3RCLE1BQUksTUFBTSxHQUFHLGlDQUFpQyxHQUFHLE1BQU0sQ0FBQyxTQUFTLENBQUMsV0FBVyxDQUFDO0FBQzlFLEtBQUcsQ0FBQyxNQUFNLEdBQUcsWUFBWTs7O0FBR3hCLFdBQVEsQ0FBQyxHQUFHLENBQUU7QUFDYixXQUFPLEVBQUUsT0FBTztBQUNoQixZQUFRLEVBQUUsT0FBTztBQUNqQix1QkFBbUIsRUFBRSxXQUFXO0FBQ2hDLHFCQUFpQixFQUFFLGFBQWE7QUFDaEMsc0JBQWtCLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxHQUFHO0FBQ3pDLGFBQVMsRUFBRSxNQUFNO0lBQ2pCLENBQUUsQ0FBQztBQUNKLFdBQVEsQ0FBQyxNQUFNLENBQUUsSUFBSSxDQUFFLENBQUM7R0FFeEIsQ0FBQztBQUNGLEtBQUcsQ0FBQyxHQUFHLEdBQUcsTUFBTSxDQUFDOztBQUVqQixVQUFRLENBQUMsRUFBRSxDQUFFLE9BQU8sRUFBRSxVQUFXLEdBQUcsRUFBRztBQUN0QyxTQUFNLENBQUMsRUFBRSxDQUFFLGFBQWEsRUFBRSxFQUFFLE9BQU8sRUFBRSxNQUFNLENBQUMsU0FBUyxDQUFDLEVBQUUsRUFBRSxDQUFFLENBQUM7R0FDN0QsQ0FBRSxDQUFDO0VBRUo7O0FBRUQsUUFBTztBQUNOLFVBQVEsRUFBRSxHQUFHO0FBQ2IsU0FBTyxFQUFFLElBQUk7QUFDYixZQUFVLEVBQUUsSUFBSTtBQUNoQixVQUFRLEVBQUUsZ0NBQWdDO0VBQzFDLENBQUM7Q0FFRixDQUFFLENBQUM7Ozs7O0FDckNKLE9BQU8sQ0FBQyxNQUFNLENBQUUsS0FBSyxFQUFFLENBQ3RCLFdBQVcsRUFDWCxXQUFXLENBQ1gsQ0FBRSxDQUNGLFFBQVEsQ0FBRSxjQUFjLEVBQUUsd0JBQXdCLENBQUUsQ0FDcEQsUUFBUSxDQUFFLFVBQVUsRUFBRTtBQUN0QixJQUFHLEVBQUUsa0NBQWtDO0FBQ3ZDLElBQUcsRUFBRSw4QkFBOEI7Q0FDbkMsQ0FBRSxDQUVGLFFBQVEsQ0FBRSxLQUFLLEVBQUUsT0FBTyxDQUFFLG1CQUFtQixDQUFFLENBQUUsQ0FFakQsT0FBTyxDQUFFLE1BQU0sRUFBRSxPQUFPLENBQUUsV0FBVyxDQUFFLENBQUUsQ0FDekMsVUFBVSxDQUFFLFVBQVUsRUFBRSxPQUFPLENBQUUsZ0JBQWdCLENBQUUsQ0FBRSxDQUNyRCxPQUFPLENBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBRSxlQUFlLENBQUUsQ0FBRSxDQUM3QyxPQUFPLENBQUUsS0FBSyxFQUFFLE9BQU8sQ0FBRSxpQkFBaUIsQ0FBRSxDQUFFLENBQzlDLFVBQVUsQ0FBRSxpQkFBaUIsRUFBRSxPQUFPLENBQUUsdUJBQXVCLENBQUUsQ0FBRSxDQUNuRSxTQUFTLENBQUUsU0FBUyxFQUFFLE9BQU8sQ0FBRSx3QkFBd0IsQ0FBRSxDQUFFLENBQzNELE9BQU8sQ0FBRSxRQUFRLEVBQUUsT0FBTyxDQUFFLHVCQUF1QixDQUFFLENBQUUsQ0FDdkQsT0FBTyxDQUFFLE9BQU8sRUFBRSxPQUFPLENBQUUsc0JBQXNCLENBQUUsQ0FBRSxDQUNyRCxTQUFTLENBQUUsUUFBUSxFQUFFLE9BQU8sQ0FBRSx1QkFBdUIsQ0FBRSxDQUFFLENBRXpELFVBQVUsQ0FBRSxZQUFZLEVBQUUsT0FBTyxDQUFFLHVCQUF1QixDQUFFLENBQUUsQ0FDOUQsVUFBVSxDQUFFLFlBQVksRUFBRSxPQUFPLENBQUUsdUJBQXVCLENBQUUsQ0FBRSxDQUM5RCxVQUFVLENBQUUsYUFBYSxFQUFFLE9BQU8sQ0FBRSx3QkFBd0IsQ0FBRSxDQUFFLENBQ2hFLFVBQVUsQ0FBRSxhQUFhLEVBQUUsT0FBTyxDQUFFLHdCQUF3QixDQUFFLENBQUUsQ0FFaEUsT0FBTyxDQUFFLE1BQU0sRUFBRSxPQUFPLENBQUUsb0JBQW9CLENBQUUsQ0FBRSxDQUNsRCxPQUFPLENBQUUsV0FBVyxFQUFFLE9BQU8sQ0FBRSx5QkFBeUIsQ0FBRSxDQUFFLENBQzVELE9BQU8sQ0FBRSxpQkFBaUIsRUFBRSxPQUFPLENBQUUsK0JBQStCLENBQUUsQ0FBRSxDQUV4RSxNQUFNLENBQUUsQ0FBRSxnQkFBZ0IsRUFBRSxvQkFBb0IsRUFBRSxlQUFlLEVBQ2xFLFVBQVcsY0FBYyxFQUFFLGtCQUFrQixFQUFFLGFBQWEsRUFBRzs7QUFFOUQsbUJBQWtCLENBQUMsU0FBUyxDQUFFLEdBQUcsQ0FBRSxDQUFDOztBQUVwQyxlQUFjLENBQ1osS0FBSyxDQUFFLE1BQU0sRUFBRTtBQUNmLEtBQUcsRUFBRSxHQUFHO0FBQ1IsYUFBVyxFQUFFLHNCQUFzQjtFQUNuQyxDQUFFLENBQ0YsS0FBSyxDQUFFLGFBQWEsRUFBRTtBQUN0QixLQUFHLEVBQUUsaUJBQWlCO0FBQ3RCLGFBQVcsRUFBRSx1QkFBdUI7QUFDcEMsWUFBVSxFQUFFLGlCQUFpQjtBQUM3QixjQUFZLEVBQUUsSUFBSTtBQUNsQixTQUFPLEVBQUU7QUFDUixZQUFTLEVBQUUsQ0FBRSxjQUFjLEVBQUUsTUFBTSxFQUFFLFVBQVcsWUFBWSxFQUFFLElBQUksRUFBRztBQUNwRSxXQUFPLElBQUksQ0FBQyxVQUFVLENBQUUsWUFBWSxDQUFDLE9BQU8sQ0FBRSxDQUFDO0lBQy9DLENBQUM7R0FDRjtFQUNELENBQUUsQ0FDRixLQUFLLENBQUUsUUFBUSxFQUFFO0FBQ2pCLEtBQUcsRUFBRSxTQUFTO0FBQ2QsYUFBVyxFQUFFLHdCQUF3QjtBQUNyQyxZQUFVLEVBQUUsWUFBWTtBQUN4QixjQUFZLEVBQUUsUUFBUTtFQUN0QixDQUFFLENBQ0YsS0FBSyxDQUFFLFFBQVEsRUFBRTtBQUNqQixLQUFHLEVBQUUsU0FBUztBQUNkLGFBQVcsRUFBRSx3QkFBd0I7QUFDckMsWUFBVSxFQUFFLFlBQVk7QUFDeEIsY0FBWSxFQUFFLFFBQVE7RUFDdEIsQ0FBRSxDQUNGLEtBQUssQ0FBRSxTQUFTLEVBQUU7QUFDbEIsS0FBRyxFQUFFLFVBQVU7QUFDZixZQUFVLEVBQUUsYUFBYTtFQUN6QixDQUFFLENBQ0YsS0FBSyxDQUFDLFNBQVMsRUFBRTtBQUNqQixLQUFHLEVBQUUsVUFBVTtBQUNmLGFBQVcsRUFBRSx5QkFBeUI7QUFDdEMsWUFBVSxFQUFFLGFBQWE7QUFDekIsY0FBWSxFQUFFLFNBQVM7QUFDdkIsU0FBTyxFQUFFO0FBQ1IsWUFBUyxFQUFFLENBQUUsTUFBTSxFQUFFLFVBQVcsSUFBSSxFQUFHO0FBQ3RDLFdBQU8sSUFBSSxDQUFDLFNBQVMsRUFBRSxDQUFDO0lBQ3hCLENBQUU7R0FDSDtFQUNELENBQUMsQ0FDRjs7QUFFRCxjQUFhLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBRSxpQkFBaUIsQ0FBRSxDQUFDO0NBRXJELENBQUUsQ0FBRSxDQUNKLEdBQUcsQ0FBRSxDQUFFLFlBQVksRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLFVBQVcsVUFBVSxFQUFFLE1BQU0sRUFBRSxJQUFJLEVBQUc7Ozs7QUFJN0UsS0FBSSxDQUFDLFNBQVMsQ0FBRSxJQUFJLENBQUUsQ0FBQzs7QUFFdkIsV0FBVSxDQUFDLEdBQUcsQ0FBRSxtQkFBbUIsRUFBRSxVQUFXLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUFFLFNBQVMsRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFHOztBQUV4RyxPQUFLLENBQUMsY0FBYyxFQUFFLENBQUM7QUFDdkIsU0FBTyxDQUFDLEdBQUcsQ0FBRSxLQUFLLENBQUUsQ0FBQztBQUNyQixNQUFLLEtBQUssRUFBRztBQUNaLFNBQU0sQ0FBQyxFQUFFLENBQUUsUUFBUSxDQUFFLENBQUM7R0FDdEI7RUFFRCxDQUFFLENBQUM7Q0FFSixDQUFFLENBQUUsQ0FDSixNQUFNLENBQUUsQ0FBRSxhQUFhLEVBQUUsZUFBZSxFQUFFLFVBQVcsV0FBVyxFQUFFLGFBQWEsRUFBRzs7QUFFbEYsWUFBVyxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQzFCLFlBQVcsQ0FBQyxvQkFBb0IsQ0FBRSxNQUFNLEVBQUUsS0FBSyxDQUFFLENBQUM7O0FBRWxELGNBQWEsQ0FBQywwQkFBMEIsQ0FBRSxLQUFLLENBQUUsQ0FBQztDQUVsRCxDQUFFLENBQUUsQ0FDSjs7Ozs7QUM3R0QsTUFBTSxDQUFDLE9BQU8sR0FBRyxDQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsTUFBTSxFQUFFLEtBQUssRUFBRSxPQUFPLEVBQUUsUUFBUSxFQUNwRSxVQUFXLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLEdBQUcsRUFBRSxLQUFLLEVBQUUsTUFBTSxFQUFHOztBQUVsRCxLQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxHQUFFLENBQUMsTUFBTSxHQUFHO0FBQ1gsT0FBSyxFQUFFLEVBQUU7RUFDVCxDQUFDO0FBQ0YsR0FBRSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUM7O0FBRXJCLE9BQU0sQ0FBQyxNQUFNLENBQUUsSUFBSSxDQUFDLE1BQU0sRUFBRSxVQUFXLFFBQVEsRUFBRzs7QUFFakQsSUFBRSxDQUFDLFVBQVUsR0FBRyxRQUFRLENBQUM7QUFDekIsT0FBSyxDQUFDLGdCQUFnQixDQUFFLFFBQVEsQ0FBQyxLQUFLLENBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBRSxFQUFFLElBQUksQ0FBQyxhQUFhLENBQUUsQ0FBQztFQUVuRixFQUFFLElBQUksQ0FBRSxDQUFDOztBQUVWLEtBQUksU0FBUyxHQUFHLEVBQUUsQ0FBQztBQUNuQixHQUFFLENBQUMsTUFBTSxHQUFHLFlBQVk7QUFDdkIsTUFBSyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssS0FBSyxFQUFFLEVBQUcsT0FBTztBQUNyQyxNQUFLLFNBQVMsS0FBSyxFQUFFLENBQUMsTUFBTSxDQUFDLEtBQUssRUFBRztBQUNwQyxZQUFTLEdBQUcsRUFBRSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUM7QUFDNUIsT0FBSSxDQUFDLFdBQVcsRUFBRSxDQUFDO0FBQ25CLFFBQUssQ0FBQyxRQUFRLEVBQUUsQ0FBQztBQUNqQixTQUFNLENBQUMsV0FBVyxFQUFFLENBQUM7R0FDckI7QUFDRCxNQUFJLENBQUMsYUFBYSxDQUFFLEVBQUUsQ0FBQyxNQUFNLENBQUUsQ0FBQztFQUNoQyxDQUFDOzs7QUFHRixPQUFNLENBQUMsS0FBSyxHQUFHLE1BQU0sQ0FBQztBQUN0QixHQUFFLENBQUMsSUFBSSxHQUFHLElBQUksQ0FBQztBQUNmLEdBQUUsQ0FBQyxLQUFLLEdBQUcsS0FBSyxDQUFDO0FBQ2pCLEdBQUUsQ0FBQyxNQUFNLEdBQUcsTUFBTSxDQUFDOztBQUVuQixJQUFHLENBQUMsR0FBRyxDQUFDLE1BQU0sQ0FBRSxZQUFZO0FBQzNCLEtBQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLHFCQUFxQixDQUFFLENBQUM7RUFDM0MsQ0FBRSxDQUFDO0NBRUosQ0FBRSxDQUFDOzs7OztBQ3RDSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLFFBQVEsRUFBRSxNQUFNLEVBQUUsZUFBZSxFQUFFLFdBQVcsRUFDeEUsVUFBVSxHQUFHLEVBQUUsTUFBTSxFQUFFLElBQUksRUFBRSxhQUFhLEVBQUUsU0FBUyxFQUFHOztBQUV2RCxLQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxHQUFFLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztBQUN6QixJQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSw0QkFBNEIsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFFLENBQUM7O0FBRWhFLFVBQVMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQztBQUN0QyxLQUFLLFNBQVMsQ0FBQyxLQUFLLEtBQUssU0FBUyxDQUFDLGNBQWMsRUFBRztBQUNuRCxXQUFTLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUFHLFNBQVMsQ0FBQyxjQUFjLEdBQUcsR0FBRyxDQUFDO0VBQzlFOztBQUVELEtBQUssU0FBUyxDQUFDLGFBQWEsRUFBRztBQUM5QixNQUFJLE1BQU0sR0FBRyxvQ0FBb0MsR0FBRyxTQUFTLENBQUMsYUFBYSxDQUFDO0FBQzVFLEdBQUMsQ0FBRSxXQUFXLENBQUUsQ0FBQyxHQUFHLENBQUU7QUFDckIscUJBQWtCLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxHQUFHO0dBQ3pDLENBQUUsQ0FBQztFQUNKO0NBRUQsQ0FBRSxDQUFDOzs7OztBQ25CSixNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsWUFBWTs7QUFFOUIsVUFBUyxRQUFRLENBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxTQUFTLEVBQUc7QUFDMUMsTUFBSSxLQUFLLEdBQUcsSUFBSTtNQUNmLFVBQVUsR0FBRyxTQUFTLENBQUM7O0FBRXhCLE1BQUksT0FBTyxDQUFDO0FBQ1osU0FBTyxZQUFZOztBQUVsQixPQUFJLE9BQU8sR0FBRyxLQUFLO09BQ2xCLElBQUksR0FBRyxVQUFVLENBQUM7QUFDbkIsT0FBSSxLQUFLLEdBQUcsU0FBUyxLQUFLLEdBQUc7O0FBRTVCLFdBQU8sR0FBRyxJQUFJLENBQUM7QUFDZixRQUFLLENBQUMsU0FBUyxFQUFHLElBQUksQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLElBQUksQ0FBRSxDQUFDO0lBQzlDLENBQUM7QUFDRixPQUFJLE9BQU8sR0FBRyxTQUFTLElBQUksQ0FBQyxPQUFPLENBQUM7QUFDcEMsZUFBWSxDQUFFLE9BQU8sQ0FBRSxDQUFDO0FBQ3hCLFVBQU8sR0FBRyxVQUFVLENBQUUsS0FBSyxFQUFFLElBQUksQ0FBRSxDQUFDO0FBQ3BDLE9BQUssT0FBTyxFQUFHLElBQUksQ0FBQyxLQUFLLENBQUUsT0FBTyxFQUFFLElBQUksQ0FBRSxDQUFDO0dBQzNDLENBQUM7RUFDRjs7QUFFRCxRQUFPO0FBQ04sVUFBUSxFQUFSLFFBQVE7RUFDUixDQUFDO0NBRUYsQ0FBRSxDQUFDIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRodHRwJywgJ1RNREJfQVBJJywgJ0VWVCcsICckY2FjaGVGYWN0b3J5JywgJyRxJywgJ0VORFBPSU5UX1VSSScsXHJcbmZ1bmN0aW9uICggbG9nLCAkaHR0cCwgVE1EQl9BUEksIEVWVCwgJGNhY2hlRmFjdG9yeSwgJHEsIEVORFBPSU5UX1VSSSApIHtcclxuXHJcblx0dmFyIHNlYXJjaFJlc3VsdCA9IFtdO1xyXG5cdHZhciBwcmV2UmVzdWx0TGVuID0gMDtcclxuXHR2YXIgdG90YWxQYWdlcyA9IC0xO1xyXG5cdHZhciBjdXJyUGFnZSA9IDE7XHJcblxyXG5cdHZhciBtb3ZpZUlkQ2FjaGUgPSAkY2FjaGVGYWN0b3J5KCAnbW92aWVJZENhY2hlJyApO1xyXG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ21vdmllLyc7XHJcblxyXG5cdGZ1bmN0aW9uIHB1dEl0ZW1Ub0RCKCBtb3ZpZUl0ZW0gKSB7XHJcblx0XHQvLyB0b2RvIGRvbnQgcHV0IGV4aXNpdGluZyBpdGVtIGluIGRiXHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ1BVVDonLCByZXMgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnUFVUOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbURCKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCArIGlkIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IERCOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tQVBJKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XHJcblx0XHRcdHBhcmFtczogeyBhcGlfa2V5OiBUTURCX0FQSS5rZXkgfVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xyXG5cdFx0XHRwdXRJdGVtVG9EQiggcmVzLmRhdGEgKTtcclxuXHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IEFQSTonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XHJcblxyXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xyXG5cdFx0aWYgKCBjYWNoZWRJdGVtICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gY2FjaGU6JywgY2FjaGVkSXRlbSApO1xyXG5cdFx0XHRyZXR1cm4gY2FjaGVkSXRlbTtcclxuXHRcdH1cclxuXHJcblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xyXG5cdFx0dmFyIGRmX1JlcyA9ICRxLmRlZmVyKCk7XHJcblxyXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGlmICggcmVzICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlc29sdmUoIHJlcyApO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggJ25vdCBmb3VuZCcgKTtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRkZl9EQi5wcm9taXNlLnRoZW4oIGZ1bmN0aW9uICggcmVzX0RCICkge1xyXG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX0RCICk7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0c2VhcmNoSWRGcm9tQVBJKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX2FwaSApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlamVjdCggZXJyX2FwaSApO1xyXG5cdFx0XHR9ICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcclxuXHJcblx0XHRpZiAoIGN1cnJQYWdlID4gdG90YWxQYWdlcyAmJiB0b3RhbFBhZ2VzICE9PSAtMSApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxyXG5cdFx0XHRFVlQuRU9QLmVtaXQoKTtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cclxuXHRcdCRodHRwKCB7XHJcblx0XHRcdG1ldGhvZDogJ0dFVCcsXHJcblx0XHRcdGNhY2hlOiB0cnVlLFxyXG5cdFx0XHR1cmw6IFRNREJfQVBJLnVybCArICdzZWFyY2gvbW92aWUnLFxyXG5cdFx0XHRwYXJhbXM6e1xyXG5cdFx0XHRcdGFwaV9rZXk6IFRNREJfQVBJLmtleSxcclxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxyXG5cdFx0XHRcdHBhZ2U6IGN1cnJQYWdlXHJcblx0XHRcdH1cclxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggc3VjY2Vzc1xyXG5cdFx0XHRzZWFyY2hSZXN1bHQgPSBzZWFyY2hSZXN1bHQuY29uY2F0KCByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXMuZGF0YS5yZXN1bHRzICkgKTtcclxuXHRcdFx0dG90YWxQYWdlcyA9IHJlcy5kYXRhLnRvdGFsX3BhZ2VzO1xyXG5cdFx0XHRjdXJyUGFnZSArKztcclxuXHRcdFx0cHJldlJlc3VsdExlbiA9IHNlYXJjaFJlc3VsdC5sZW5ndGg7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCByZXMsIHJlcy5kYXRhICk7XHJcblxyXG5cdFx0XHQvLyBjYWNoZVxyXG5cdFx0XHRyZXMuZGF0YS5yZXN1bHRzLmZvckVhY2goIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHJcblx0XHRcdFx0aWYgKCAhbW92aWVJZENhY2hlLmdldCggaXRlbS5pZCApICkge1xyXG5cdFx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggaXRlbS5pZCwgaXRlbSApO1xyXG5cdFx0XHRcdFx0Ly8gcHV0SXRlbVRvREIoIGl0ZW0gKTsgLy8gdG9kbyBjaGVjayBpZiBhbHJlYWR5IGV4aXRzIGluIERCXHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0fSApO1xyXG5cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBlcnJcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzdWx0cyApIHtcclxuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0UmVzKCkge1xyXG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xyXG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXHJcblx0XHRzZWFyY2hSZXN1bHQubGVuZ3RoID0gMDtcclxuXHRcdHByZXZSZXN1bHRMZW4gPSAwO1xyXG5cdFx0dG90YWxQYWdlcyA9IC0xO1xyXG5cdFx0Y3VyclBhZ2UgPSAxO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHNlYXJjaEJ5VGl0bGUsXHJcblx0XHRzZWFyY2hCeUlkLFxyXG5cdFx0Y2xlYXJTZWFyY2gsXHJcblx0XHRnZXRSZXMsXHJcblx0XHRwcmV2UmVzdWx0TGVuLFxyXG5cdFx0cHV0SXRlbVRvREJcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsICdhdXRoVG9rZW4nLFxuZnVuY3Rpb24gKCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xuXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcblxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XG5cblx0XHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XG5cblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XG5cblx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSgpO1xuXG5cdFx0XHR9IGVsc2Uge1xuXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnIClcblx0XHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdFx0XHRcdGNvbnNvbGUubG9nKCByZXMgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCk7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0Y29uc29sZS53YXJuKCBlcnIgKTtcblx0XHRcdFx0XHRcdC8vIHRvZG8gaWYgand0IGV4cGlyZWQgLCBkZWF1dGhvcml6ZSwgcmVtb3ZlIGxvY2FsIHN0b3JhZ2UsIHJlZGlyZWN0XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXG5cdFx0XHRcdFx0fSApO1xuXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZGVhdXRob3JpemUoKSB7XG5cdFx0XHQvLyB3aGVuIGxvZ291dFxuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XG5cdFx0XHRpZGVudGl0eSA9IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaXNBdXRoZW50aWNhdGVkKCkge1xuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblxuXHRcdFx0YXV0aG9yaXplLFxuXHRcdFx0ZGVhdXRob3JpemUsXG5cdFx0XHRpc0F1dGhlbnRpY2F0ZWQsXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXG5cblx0XHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XG5cblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xuXG5cdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0aWYgKCB0b2tlbiApIHtcblx0XHRcdC8vIGh0dHA6Ly9zZWxmLWlzc3VlZC5pbmZvL2RvY3MvZHJhZnQtaWV0Zi1vYXV0aC12Mi1iZWFyZXIuaHRtbCAgIHNlY3Rpb24gMi4xXG5cdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0Ly8gaHR0cDovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM0Lmh0bWwgc2VjdGlvbiA0LjIgaGVhZGVyIGZpZWxkIG5hbWUgY2FzZSBpbnNlbnNpdGl2ZVxuXHRcdFx0Y29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXHRcdH1cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0Y29uc29sZS5sb2coICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc2NvcGUnLCAnYXV0aCcsIGZ1bmN0aW9uICggJHNjb3BlLCBhdXRoICkgIHtcclxuXHRcclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXHJcbmZ1bmN0aW9uICggJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGNvbnNvbGUubG9nKCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nKCByZXMgKTtcclxuXHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0JHN0YXRlLmdvKCAncHJpdmF0ZScgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xyXG5cdFx0XHRcdGNvbnNvbGUud2FybiggZXJyICk7XHJcblx0XHRcdH0gKTtcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnYXV0aCcsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoICkgIHtcclxuXHJcblx0YXV0aC5kZWF1dGhvcml6ZSgpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxuZnVuY3Rpb24gKCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRjb25zb2xlLmxvZyggJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGNvbnNvbGUubG9nKCAnUmVnaXN0ZXJpbmcuLi4nICk7XHJcblx0XHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWdudXAnLCB2bS51c2VyIClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCAnUmVnaXN0ZXJlZC4nICk7XHJcblx0XHRcdFx0XHRjb25zb2xlLmxvZyggcmVzICk7XHJcblx0XHRcdFx0XHQvLyBsb2dpblxyXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xyXG5cdFx0XHRcdFx0JHN0YXRlLmdvKCAncHJpdmF0ZScgKTtcclxuXG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cblx0XHRcdFx0XHRjb25zb2xlLndhcm4oIGVyciApO1xyXG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XHJcblxuXHRcdFx0XHR9ICk7XHJcblxuXHRcdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHR2YXIgZGVidWdFbmFibGVkID0gZmFsc2U7XG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcblxuXHR0aGlzLmVuYWJsZURlYnVnID0gZnVuY3Rpb24gKCkge1xuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XG5cdH07XG5cblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XG5cdFx0XHRkZWJ1Z05hbWVzcGFjZXMucHVzaCggYXJndW1lbnRzWyBpIF0gKTtcblx0XHR9XG5cdH07XG5cblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoKSB7XG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XHJcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcclxuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XHJcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cclxuXHR9O1xyXG5cclxuXHRyZXR1cm4gRVZUO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xyXG5cdFx0JCggJHdpbmRvdyApLm9uKCAncmVzaXplJywgdXRpbC5kZWJvdW5jZSggRU5HSU5FLm9uV2luZG93UmVzaXplLCAxMDAgKSApXHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJHdpbmRvdy5pbm5lcldpZHRoLFxuXHRcdGhlaWdodDogJHdpbmRvdy5pbm5lckhlaWdodCxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICR3aW5kb3cuaW5uZXJXaWR0aDtcblx0XHQkJC5oZWlnaHQgPSAkd2luZG93LmlubmVySGVpZ2h0O1xuXHRcdCQkLnBpeGVsX3JhdGlvID0gJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG5cdFx0JCQuc2NyZWVuX3JhdGlvID0gJCQud2lkdGggLyAkJC5oZWlnaHQ7XG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcblx0XHQkJC5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuXHRcdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNldHVwKCkge1xuXG5cdH1cblxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XG5cblx0XHRpZiAoIE1hdGguYWJzKCAkJC53aGVlbF9keSApID4gMC4wMDEgKSB7XG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcblx0XHRcdCQkLmNhbWVyYS5yb3RhdGVZKCAkJC53aGVlbF9keSAqIDAuMDI1ICk7XG5cdFx0XHQkJC53aGVlbF9keSAqPSAwLjk1O1xuXHRcdH1cblxuXHR9XG5cblx0Ly8gLS0tLSAgZHJhdyBsb29wXG5cdGZ1bmN0aW9uIHJ1bigpIHtcblxuXHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSggcnVuICk7XG5cdFx0dXBkYXRlKCk7XG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XG5cdFx0JCQuc3RhdHMudXBkYXRlKCk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdHNldHVwKCk7XG5cdFx0cnVuKCk7XG5cdH1cblxuXHRmdW5jdGlvbiByZXNldENhbWVyYSgpIHtcblx0XHQkJC5jYW1lcmEucG9zaXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHQkJCxcblx0XHRhdHRhY2hSZW5kZXJlcixcblx0XHRvbldpbmRvd1Jlc2l6ZSxcblx0XHRzdGFydCxcblx0XHRyZXNldENhbWVyYSxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkdJTkUnLCAnJGNvbXBpbGUnLCAnJHJvb3RTY29wZScsXHJcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xyXG5cblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcblx0RU5HSU5FLiQkLnNjZW5lLmFkZCggYWxsUG9zdGVycyApO1xuXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcblxyXG5cdFx0dmFyIHZlY3RvciA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XHJcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgcG9zdGVyT2JqZWN0TXVsdGkubGVuZ3RoOyBpKysgKSB7XG5cblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xuXHRcdFx0JGlzb2xhdGVkU2NvcGUubW92aWVJdGVtID0gcG9zdGVyT2JqZWN0TXVsdGlbIGkgXTtcclxuXHJcblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XHJcblxyXG5cdFx0XHQvLyB0YWcgYWxvZyBhbiBpc29sYXRlZFNjb3BlIHRvIGJlIGRlc3Ryb3kgd2hlbiBkaXNwb3NlIGFuIGVsZW1lbnRcclxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcclxuXHJcblx0XHRcdHZhciBoaWR4ID0gaSArIG9mZnNldFN0YXJ0SWR4O1xuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xyXG5cclxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcclxuXG5cdFx0XHRjc3MzZE9iai5sb29rQXQoIHZlY3RvciApO1xyXG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XHJcblxyXG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckFsbCgpIHtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XHJcblx0XHRcdHBvc3Rlci5kaXNwb3NlRWxlbWVudCgpO1xyXG5cdFx0XHRwb3N0ZXIuc2NvcGUuJGRlc3Ryb3koKTtcclxuXHRcdH0gKTtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoID0gMDsgLy8gY2xlYXIgaXRlbXNcclxuXHR9XHJcblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsIGZ1bmN0aW9uICggJHN0YXRlICkge1xyXG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxyXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xyXG5cclxuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxyXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXHJcblx0XHRcdH0gKTtcclxuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XHJcblxyXG5cdFx0fTtcclxuXHRcdGltZy5zcmMgPSBpbWdVcmw7XHJcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9kZWJ1Zy9sb2cucHYuanMnICkgKVxuXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi91dGlsLmpzJyApIClcbi5jb250cm9sbGVyKCAnbWFpbkN0cmwnLCByZXF1aXJlKCAnLi9tYWluLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vVE1EYi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9ldmVudHMuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnbW92aWVEZXRhaWxDdHJsJywgcmVxdWlyZSggJy4vbW92aWVEZXRhaWwuY3RybC5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25pbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25pbi5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbm91dEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25vdXQuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3ByaXZhdGVDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9wcml2YXRlLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcblxuLmNvbmZpZyggWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdFx0LnN0YXRlKCAnaG9tZScsIHtcblx0XHRcdHVybDogJy8nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hvbWUuaHRtbCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWUuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XG5cdFx0XHRcdH1dXG5cdFx0XHR9XG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbnVwJywge1xuXHRcdFx0dXJsOiAnL3NpZ251cCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbnVwLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ251cEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25pbicsIHtcblx0XHRcdHVybDogJy9zaWduaW4nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ25pbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWduaW5DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdub3V0Jywge1xuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25vdXRDdHJsJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSgncHJpdmF0ZScsIHtcblx0XHRcdHVybDogJy9wcml2YXRlJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9wcml2YXRlLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3ByaXZhdGVDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3ByaXZhdGUnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0pXG5cdDtcblxuXHQkaHR0cFByb3ZpZGVyLmludGVyY2VwdG9ycy5wdXNoKCAnYXV0aEludGVyY2VwdG9yJyApO1xuXG59IF0gKVxuLnJ1biggWyAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnYXV0aCcsIGZ1bmN0aW9uICggJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoICkge1xuXG5cdC8vIHRvZG8gYXV0aG9yaXplIHVzZXIgZXZlcnkgYmVnaW5uaW5nIG9mIHNlc3Npb25cblx0Ly8gb3IganVzdCBjaGVjayBpZiBoYXNUb2tlbj9cblx0YXV0aC5hdXRob3JpemUoIHRydWUgKTtcblxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XG5cblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpOyAvLyBwcmV2ZW50IHRyYW5zaXRpb25cblx0XHRjb25zb2xlLmxvZyggZXJyb3IgKTtcblx0XHRpZiAoIGVycm9yICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXHRcdH1cblxuXHR9ICk7XG5cbn0gXSApXG4uY29uZmlnKCBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJyApOyAvLyBjdHJsXG5cblx0JGh0dHBQcm92aWRlci51c2VMZWdhY3lQcm9taXNlRXh0ZW5zaW9ucyggZmFsc2UgKTtcblxufSBdIClcbjtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJ0VWVCcsICdoZWxpeCcsICdFTkdJTkUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgVE1EYiwgRVZULCBoZWxpeCwgRU5HSU5FICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLnNlYXJjaCA9IHtcblx0XHRxdWVyeTogJycsXG5cdH07XG5cdHZtLm1vdmllSXRlbXMgPSBudWxsO1xuXG5cdCRzY29wZS4kd2F0Y2goIFRNRGIuZ2V0UmVzLCBmdW5jdGlvbiAoIG1vdkl0ZW1zICkge1xuXG5cdFx0dm0ubW92aWVJdGVtcyA9IG1vdkl0ZW1zO1xuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBUTURiLnByZXZSZXN1bHRMZW4gKSwgVE1EYi5wcmV2UmVzdWx0TGVuICk7XG5cblx0fSwgdHJ1ZSApO1xuXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcblx0dm0uc2VhcmNoID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmICggdm0uc2VhcmNoLnF1ZXJ5ID09PSAnJyApIHJldHVybjtcblx0XHRpZiAoIHByZXZRdWVyeSAhPT0gdm0uc2VhcmNoLnF1ZXJ5ICkge1xuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xuXHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xuXHRcdH1cblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xuXHR9O1xuXG5cdC8vIERFQlVHXG5cdHdpbmRvdy5TQ09QRSA9ICRzY29wZTtcblx0dm0uVE1EYiA9IFRNRGI7XG5cdHZtLmhlbGl4ID0gaGVsaXg7XG5cdHZtLkVOR0lORSA9IEVOR0lORTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICckY2FjaGVGYWN0b3J5JywgJ21vdmllSXRlbScsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtICkge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllSXRlbSA9IG1vdmllSXRlbTsgLy8gbW92aWVJdGVtIGluamVjdGVkIHZpYSBzdGF0ZSByZXNvbHZlXHJcblx0bG9nLmRlYnVnKCAnY3RybCcsICdtb3ZpZURldGFpbCBjdHJsIHJlc29sdmVkOicsIHZtLm1vdmllSXRlbSApO1xyXG5cclxuXHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlO1xyXG5cdGlmICggbW92aWVJdGVtLnRpdGxlICE9PSBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKSB7XHJcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcclxuXHR9XHJcblxyXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3Avb3JpZ2luYWwnICsgbW92aWVJdGVtLmJhY2tkcm9wX3BhdGg7XHJcblx0XHQkKCAnLmJhY2tkcm9wJyApLmNzcygge1xyXG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0ZnVuY3Rpb24gZGVib3VuY2UoIGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSApIHtcclxuXHRcdHZhciBfdGhpcyA9IHRoaXMsXHJcblx0XHRcdF9hcmd1bWVudHMgPSBhcmd1bWVudHM7XHJcblxyXG5cdFx0dmFyIHRpbWVvdXQ7XHJcblx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdFx0dmFyIGNvbnRleHQgPSBfdGhpcyxcclxuXHRcdFx0XHRhcmdzID0gX2FyZ3VtZW50cztcclxuXHRcdFx0dmFyIGxhdGVyID0gZnVuY3Rpb24gbGF0ZXIoKSB7XHJcblxyXG5cdFx0XHRcdHRpbWVvdXQgPSBudWxsO1xyXG5cdFx0XHRcdGlmICggIWltbWVkaWF0ZSApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcclxuXHRcdFx0fTtcclxuXHRcdFx0dmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XHJcblx0XHRcdGNsZWFyVGltZW91dCggdGltZW91dCApO1xyXG5cdFx0XHR0aW1lb3V0ID0gc2V0VGltZW91dCggbGF0ZXIsIHdhaXQgKTtcclxuXHRcdFx0aWYgKCBjYWxsTm93ICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0fTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRkZWJvdW5jZVxyXG5cdH07XHJcblxyXG59IF07XHJcbiJdfQ==
