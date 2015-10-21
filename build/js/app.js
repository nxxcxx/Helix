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

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

	var identity = null;
	var _identityResolved = false;

	function authorize(force) {

		var deferred = $q.defer();

		if (force) identity = null;

		if (identity !== null) {

			deferred.resolve();
		} else {

			$http.get(ENDPOINT_URI + 'auth', { attachJwt: true }).then(function (res) {

				log.debug('info', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve();
			}, function (err) {

				log.debug('warn', err, err.data);
				// todo if jwt expired , deauthorize, remove local storage, redirect
				_identityResolved = true;
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function deauthorize() {
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

		if (config.attachJwt) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
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

module.exports = ['log', '$window', function (log, $window) {

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
		log.debug('info', 'token removed');
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

module.exports = ['$scope', 'auth', function ($scope, auth) {

	console.log(1);
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('warn', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('info', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('warn', err);
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

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('warn', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('info', 'Registered.');
			log.debug('info', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('warn', err);
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
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
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
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('collectionCtrl', require('./auth/collection.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

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
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'collectionCtrl',
		controllerAs: 'coll',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}]
		}
	});

	$httpProvider.interceptors.push('authInterceptor');
}]).run(['log', '$rootScope', '$state', 'auth', function (log, $rootScope, $state, auth) {

	// todo authorize user every beginning of session
	auth.authorize(true);

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]).config(['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace('info', 'err', 'auth'); // ctrl

	$httpProvider.useLegacyPromiseExtensions(false);
}]);

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/collection.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./debug/log.pv.js":9,"./events.fac.js":10,"./helix/display.dir.js":11,"./helix/engine.fac.js":12,"./helix/helix.fac.js":13,"./helix/poster.dir.js":14,"./main.ctrl.js":16,"./movieDetail.ctrl.js":17,"./util.js":18}],16:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', function (log, $scope, TMDb, EVT, helix, ENGINE, auth) {

	var vm = this;
	vm.auth = auth;
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

	vm.addToCollection = function () {
		console.log(movieItem.id);
		// prompt up collection modal -> fetch usr's collection -> allow user to select which collection to add to -> save to DB
	};
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
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2NvbGxlY3Rpb24uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ25vdXQuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9kZWJ1Zy9sb2cucHYuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL3V0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdBQUcsYUFBYSxDQUFFLGNBQWMsQ0FBRSxDQUFDOzs7QUFHbkQsS0FBSSxXQUFXLEdBQUcsWUFBWSxHQUFHLFFBQVEsQ0FBQzs7QUFFMUMsVUFBUyxXQUFXLENBQUUsU0FBUyxFQUFHOztBQUVqQyxPQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxTQUFTLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBRSxDQUNqRCxJQUFJLENBQUUs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SyxHQUFHOztBQUU1QixXQUFPLEdBQUcsSUFBSSxDQUFDO0FBQ2YsUUFBSyxDQUFDLFNBQVMsRUFBRyxJQUFJLENBQUMsS0FBSyxDQUFFLE9BQU8sRUFBRSxJQUFJLENBQUUsQ0FBQztJQUM5QyxDQUFDO0FBQ0YsT0FBSSxPQUFPLEdBQUcsU0FBUyxJQUFJLENBQUMsT0FBTyxDQUFDO0FBQ3BDLGVBQVksQ0FBRSxPQUFPLENBQUUsQ0FBQztBQUN4QixVQUFPLEdBQUcsVUFBVSxDQUFFLEtBQUssRUFBRSxJQUFJLENBQUUsQ0FBQztBQUNwQyxPQUFLLE9BQU8sRUFBRyxJQUFJLENBQUMsS0FBSyxDQUFFLE9BQU8sRUFBRSxJQUFJLENBQUUsQ0FBQztHQUMzQyxDQUFDO0VBQ0Y7O0FBRUQsUUFBTztBQUNOLFVBQVEsRUFBUixRQUFRO0VBQ1IsQ0FBQztDQUVGLENBQUUsQ0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxyXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XHJcblxyXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcclxuXHR2YXIgcHJldlJlc3VsdExlbiA9IDA7XHJcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcclxuXHR2YXIgY3VyclBhZ2UgPSAxO1xyXG5cclxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcclxuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xyXG5cclxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xyXG5cdFx0Ly8gdG9kbyBkb250IHB1dCBleGlzaXRpbmcgaXRlbSBpbiBkYlxyXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCArIG1vdmllSXRlbS5pZCwgbW92aWVJdGVtIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdQVVQ6JywgcmVzICk7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ1BVVDonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21EQiggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggREJfRU5EUE9JTlQgKyBpZCApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xyXG5cdFx0XHRpZiAoIHJlcy5kYXRhICkge1xyXG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRyZXR1cm4gbnVsbDtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24oIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0XHRyZXR1cm4gcHJvbWlzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbUFQSSggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ21vdmllLycgKyBpZCwge1xyXG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cclxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IEFQSTonLCByZXMuZGF0YSApO1xyXG5cdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCByZXMuZGF0YS5pZCwgcmVzLmRhdGEgKTtcclxuXHRcdFx0cHV0SXRlbVRvREIoIHJlcy5kYXRhICk7XHJcblx0XHRcdHJldHVybiByZXMuZGF0YTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0XHRyZXR1cm4gcHJvbWlzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5SWQoIGlkICkge1xyXG5cclxuXHRcdHZhciBjYWNoZWRJdGVtID0gbW92aWVJZENhY2hlLmdldCggaWQgKTtcclxuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcclxuXHRcdFx0cmV0dXJuIGNhY2hlZEl0ZW07XHJcblx0XHR9XHJcblxyXG5cdFx0dmFyIGRmX0RCID0gJHEuZGVmZXIoKTtcclxuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdHNlYXJjaElkRnJvbURCKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRpZiAoIHJlcyApIHtcclxuXHRcdFx0XHRkZl9EQi5yZXNvbHZlKCByZXMgKTtcclxuXHRcdFx0fSBlbHNlIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcclxuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19EQiApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19hcGkgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnJfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcclxuXHRcdFx0fSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeVRpdGxlKCBzZWFyY2hPYmogKSB7XHJcblxyXG5cdFx0aWYgKCBjdXJyUGFnZSA+IHRvdGFsUGFnZXMgJiYgdG90YWxQYWdlcyAhPT0gLTEgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgZW5kIG9mIHBhZ2VcclxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cCgge1xyXG5cdFx0XHRtZXRob2Q6ICdHRVQnLFxyXG5cdFx0XHRjYWNoZTogdHJ1ZSxcclxuXHRcdFx0dXJsOiBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJyxcclxuXHRcdFx0cGFyYW1zOntcclxuXHRcdFx0XHRhcGlfa2V5OiBUTURCX0FQSS5rZXksXHJcblx0XHRcdFx0cXVlcnk6IHNlYXJjaE9iai5xdWVyeSxcclxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxyXG5cdFx0XHR9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3NcclxuXHRcdFx0c2VhcmNoUmVzdWx0ID0gc2VhcmNoUmVzdWx0LmNvbmNhdCggcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzLmRhdGEucmVzdWx0cyApICk7XHJcblx0XHRcdHRvdGFsUGFnZXMgPSByZXMuZGF0YS50b3RhbF9wYWdlcztcclxuXHRcdFx0Y3VyclBhZ2UgKys7XHJcblx0XHRcdHByZXZSZXN1bHRMZW4gPSBzZWFyY2hSZXN1bHQubGVuZ3RoO1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgcmVzLCByZXMuZGF0YSApO1xyXG5cclxuXHRcdFx0Ly8gY2FjaGVcclxuXHRcdFx0cmVzLmRhdGEucmVzdWx0cy5mb3JFYWNoKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblxyXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcclxuXHRcdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIGl0ZW0uaWQsIGl0ZW0gKTtcclxuXHRcdFx0XHRcdC8vIHB1dEl0ZW1Ub0RCKCBpdGVtICk7IC8vIHRvZG8gY2hlY2sgaWYgYWxyZWFkeSBleGl0cyBpbiBEQlxyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XHJcblx0XHRyZXR1cm4gcmVzdWx0cy5maWx0ZXIoIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcclxuXHRcdHJldHVybiBzZWFyY2hSZXN1bHQ7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbGVhclNlYXJjaCgpIHtcclxuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxyXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XHJcblx0XHRwcmV2UmVzdWx0TGVuID0gMDtcclxuXHRcdHRvdGFsUGFnZXMgPSAtMTtcclxuXHRcdGN1cnJQYWdlID0gMTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRzZWFyY2hCeVRpdGxlLFxyXG5cdFx0c2VhcmNoQnlJZCxcclxuXHRcdGNsZWFyU2VhcmNoLFxyXG5cdFx0Z2V0UmVzLFxyXG5cdFx0cHJldlJlc3VsdExlbixcclxuXHRcdHB1dEl0ZW1Ub0RCXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgJ2F1dGhUb2tlbicsXG5mdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEsIGF1dGhUb2tlbiApIHtcblxuXHRcdHZhciBpZGVudGl0eSA9IG51bGw7XG5cdFx0dmFyIF9pZGVudGl0eVJlc29sdmVkID0gZmFsc2U7XG5cblx0XHRmdW5jdGlvbiBhdXRob3JpemUoIGZvcmNlICkge1xuXG5cdFx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xuXG5cdFx0XHRpZiAoIGZvcmNlICkgaWRlbnRpdHkgPSBudWxsO1xuXG5cdFx0XHRpZiAoIGlkZW50aXR5ICE9PSBudWxsICkge1xuXG5cdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoKTtcblxuXHRcdFx0fSBlbHNlIHtcblxuXHRcdFx0XHQkaHR0cC5nZXQoIEVORFBPSU5UX1VSSSArICdhdXRoJywgeyBhdHRhY2hKd3Q6IHRydWUgfSApXG5cdFx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgcmVzLCByZXMuZGF0YSApO1xuXHRcdFx0XHRcdFx0aWRlbnRpdHkgPSByZXMuZGF0YTtcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoKTtcblxuXHRcdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyLCBlcnIuZGF0YSApO1xuXHRcdFx0XHRcdFx0Ly8gdG9kbyBpZiBqd3QgZXhwaXJlZCAsIGRlYXV0aG9yaXplLCByZW1vdmUgbG9jYWwgc3RvcmFnZSwgcmVkaXJlY3Rcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cblx0XHRcdFx0XHR9ICk7XG5cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG5cblx0XHR9XG5cblx0XHRmdW5jdGlvbiBkZWF1dGhvcml6ZSgpIHtcblx0XHRcdGF1dGhUb2tlbi5yZW1vdmVUb2tlbigpO1xuXHRcdFx0aWRlbnRpdHkgPSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlzQXV0aGVudGljYXRlZCgpIHtcblx0XHRcdHJldHVybiBpZGVudGl0eSAhPT0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpZGVudGl0eVJlc29sdmVkKCkge1xuXHRcdFx0cmV0dXJuIF9pZGVudGl0eVJlc29sdmVkO1xuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cblx0XHRcdGF1dGhvcml6ZSxcblx0XHRcdGRlYXV0aG9yaXplLFxuXHRcdFx0aXNBdXRoZW50aWNhdGVkLFxuXHRcdFx0aWRlbnRpdHlSZXNvbHZlZFxuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdhdXRoVG9rZW4nLCBmdW5jdGlvbiAoIGF1dGhUb2tlbiApIHtcblxuXHRmdW5jdGlvbiByZXF1ZXN0KCBjb25maWcgKSB7XG5cblx0XHRpZiAoIGNvbmZpZy5hdHRhY2hKd3QgKSB7XG5cdFx0XHR2YXIgdG9rZW4gPSBhdXRoVG9rZW4uZ2V0VG9rZW4oKTtcblx0XHRcdGlmICggdG9rZW4gKSB7XG5cdFx0XHRcdC8vIGh0dHA6Ly9zZWxmLWlzc3VlZC5pbmZvL2RvY3MvZHJhZnQtaWV0Zi1vYXV0aC12Mi1iZWFyZXIuaHRtbCAgIHNlY3Rpb24gMi4xXG5cdFx0XHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL2dtYWlsL21hcmt1cC9hY3Rpb25zL3ZlcmlmeWluZy1iZWFyZXItdG9rZW5zXG5cdFx0XHRcdC8vIGh0dHA6Ly93d3cudzMub3JnL1Byb3RvY29scy9yZmMyNjE2L3JmYzI2MTYtc2VjNC5odG1sIHNlY3Rpb24gNC4yIGhlYWRlciBmaWVsZCBuYW1lIGNhc2UgaW5zZW5zaXRpdmVcblx0XHRcdFx0Y29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBjb25maWc7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc3BvbnNlKCByZXMgKSB7XG5cdFx0cmV0dXJuIHJlcztcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRyZXF1ZXN0LFxuXHRcdHJlc3BvbnNlXG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckd2luZG93JywgZnVuY3Rpb24gKCBsb2csICR3aW5kb3cgKSB7XG5cblx0dmFyIHN0b3JhZ2UgPSAkd2luZG93LmxvY2FsU3RvcmFnZTtcblx0dmFyIGNhY2hlZFRva2VuID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRUb2tlbiggdG9rZW4gKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSB0b2tlbjtcblx0XHRzdG9yYWdlLnNldEl0ZW0oICdqd3QnLCB0b2tlbiApO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0VG9rZW4oKSB7XG5cdFx0aWYgKCAhY2FjaGVkVG9rZW4gKSB7XG5cdFx0XHRjYWNoZWRUb2tlbiA9IHN0b3JhZ2UuZ2V0SXRlbSggJ2p3dCcgKTtcblx0XHR9XG5cdFx0cmV0dXJuIGNhY2hlZFRva2VuO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlVG9rZW4oKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSBudWxsO1xuXHRcdHN0b3JhZ2UucmVtb3ZlSXRlbSggJ2p3dCcgKTtcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3Rva2VuIHJlbW92ZWQnICk7XG5cdH1cblxuXHRmdW5jdGlvbiBoYXNUb2tlbigpIHtcblx0XHRyZXR1cm4gISFnZXRUb2tlbigpO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHNldFRva2VuLFxuXHRcdGdldFRva2VuLFxuXHRcdHJlbW92ZVRva2VuLFxuXHRcdGhhc1Rva2VuXG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzY29wZScsICdhdXRoJywgZnVuY3Rpb24gKCAkc2NvcGUsIGF1dGggKSAge1xyXG5cclxuXHRjb25zb2xlLmxvZyggMSApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCByZXMsIHJlcy5kYXRhICk7XHJcblx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xyXG5cdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uKCBlcnIsIHN0YXR1cyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyICk7XHJcblx0XHRcdH0gKTtcclxuXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnYXV0aCcsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoICkgIHtcclxuXHJcblx0YXV0aC5kZWF1dGhvcml6ZSgpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdSZWdpc3RlcmVkLicgKTtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCByZXMgKTtcclxuXHJcblx0XHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnIgKTtcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcclxuXG5cdFx0XHRcdH0gKTtcclxuXG5cdFx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcclxuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xyXG5cdFx0XHR2YXIgc2xpY2VkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKCBhcmd1bWVudHMsIDEgKTtcclxuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnaW5mbycgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUud2Fybi5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cclxuXHR9O1xyXG5cclxuXHRyZXR1cm4gRVZUO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xyXG5cdFx0JCggJHdpbmRvdyApLm9uKCAncmVzaXplJywgdXRpbC5kZWJvdW5jZSggRU5HSU5FLm9uV2luZG93UmVzaXplLCAxMDAgKSApXHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJHdpbmRvdy5pbm5lcldpZHRoLFxuXHRcdGhlaWdodDogJHdpbmRvdy5pbm5lckhlaWdodCxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICR3aW5kb3cuaW5uZXJXaWR0aDtcblx0XHQkJC5oZWlnaHQgPSAkd2luZG93LmlubmVySGVpZ2h0O1xuXHRcdCQkLnBpeGVsX3JhdGlvID0gJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG5cdFx0JCQuc2NyZWVuX3JhdGlvID0gJCQud2lkdGggLyAkJC5oZWlnaHQ7XG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcblx0XHQkJC5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuXHRcdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNldHVwKCkge1xuXG5cdH1cblxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XG5cblx0XHRpZiAoIE1hdGguYWJzKCAkJC53aGVlbF9keSApID4gMC4wMDEgKSB7XG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcblx0XHRcdCQkLmNhbWVyYS5yb3RhdGVZKCAkJC53aGVlbF9keSAqIDAuMDI1ICk7XG5cdFx0XHQkJC53aGVlbF9keSAqPSAwLjk1O1xuXHRcdH1cblxuXHR9XG5cblx0Ly8gLS0tLSAgZHJhdyBsb29wXG5cdGZ1bmN0aW9uIHJ1bigpIHtcblxuXHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSggcnVuICk7XG5cdFx0dXBkYXRlKCk7XG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XG5cdFx0JCQuc3RhdHMudXBkYXRlKCk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdHNldHVwKCk7XG5cdFx0cnVuKCk7XG5cdH1cblxuXHRmdW5jdGlvbiByZXNldENhbWVyYSgpIHtcblx0XHQkJC5jYW1lcmEucG9zaXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHQkJCxcblx0XHRhdHRhY2hSZW5kZXJlcixcblx0XHRvbldpbmRvd1Jlc2l6ZSxcblx0XHRzdGFydCxcblx0XHRyZXNldENhbWVyYSxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkdJTkUnLCAnJGNvbXBpbGUnLCAnJHJvb3RTY29wZScsXHJcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xyXG5cblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcblx0RU5HSU5FLiQkLnNjZW5lLmFkZCggYWxsUG9zdGVycyApO1xuXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcblxyXG5cdFx0dmFyIHZlY3RvciA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XHJcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgcG9zdGVyT2JqZWN0TXVsdGkubGVuZ3RoOyBpKysgKSB7XG5cblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xuXHRcdFx0JGlzb2xhdGVkU2NvcGUubW92aWVJdGVtID0gcG9zdGVyT2JqZWN0TXVsdGlbIGkgXTtcclxuXHJcblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XHJcblxyXG5cdFx0XHQvLyB0YWcgYWxvZyBhbiBpc29sYXRlZFNjb3BlIHRvIGJlIGRlc3Ryb3kgd2hlbiBkaXNwb3NlIGFuIGVsZW1lbnRcclxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcclxuXHJcblx0XHRcdHZhciBoaWR4ID0gaSArIG9mZnNldFN0YXJ0SWR4O1xuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xyXG5cclxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcclxuXG5cdFx0XHRjc3MzZE9iai5sb29rQXQoIHZlY3RvciApO1xyXG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XHJcblxyXG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckFsbCgpIHtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XHJcblx0XHRcdHBvc3Rlci5kaXNwb3NlRWxlbWVudCgpO1xyXG5cdFx0XHRwb3N0ZXIuc2NvcGUuJGRlc3Ryb3koKTtcclxuXHRcdH0gKTtcclxuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoID0gMDsgLy8gY2xlYXIgaXRlbXNcclxuXHR9XHJcblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsIGZ1bmN0aW9uICggJHN0YXRlICkge1xyXG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxyXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xyXG5cclxuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxyXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXHJcblx0XHRcdH0gKTtcclxuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XHJcblxyXG5cdFx0fTtcclxuXHRcdGltZy5zcmMgPSBpbWdVcmw7XHJcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9kZWJ1Zy9sb2cucHYuanMnICkgKVxuXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi91dGlsLmpzJyApIClcbi5jb250cm9sbGVyKCAnbWFpbkN0cmwnLCByZXF1aXJlKCAnLi9tYWluLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vVE1EYi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9ldmVudHMuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnbW92aWVEZXRhaWxDdHJsJywgcmVxdWlyZSggJy4vbW92aWVEZXRhaWwuY3RybC5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25pbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25pbi5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbm91dEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25vdXQuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ2NvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9jb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcblxuLmNvbmZpZyggWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdFx0LnN0YXRlKCAnaG9tZScsIHtcblx0XHRcdHVybDogJy8nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hvbWUuaHRtbCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWUuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XG5cdFx0XHRcdH1dXG5cdFx0XHR9XG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbnVwJywge1xuXHRcdFx0dXJsOiAnL3NpZ251cCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbnVwLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ251cEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25pbicsIHtcblx0XHRcdHVybDogJy9zaWduaW4nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ25pbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWduaW5DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdub3V0Jywge1xuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25vdXRDdHJsJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSgnY29sbGVjdGlvbicsIHtcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ2NvbGxlY3Rpb25DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ2NvbGwnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0pXG5cdDtcblxuXHQkaHR0cFByb3ZpZGVyLmludGVyY2VwdG9ycy5wdXNoKCAnYXV0aEludGVyY2VwdG9yJyApO1xuXG59IF0gKVxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoICkge1xuXG5cdC8vIHRvZG8gYXV0aG9yaXplIHVzZXIgZXZlcnkgYmVnaW5uaW5nIG9mIHNlc3Npb25cblx0YXV0aC5hdXRob3JpemUoIHRydWUgKTtcblxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XG5cblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpOyAvLyBwcmV2ZW50IHRyYW5zaXRpb25cblx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyb3IgKTtcblx0XHRpZiAoIGVycm9yICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXHRcdH1cblxuXHR9ICk7XG5cbn0gXSApXG4uY29uZmlnKCBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJywgJ2F1dGgnICk7IC8vIGN0cmxcblxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xuXG59IF0gKVxuO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5hdXRoID0gYXV0aDtcblx0dm0uc2VhcmNoID0ge1xuXHRcdHF1ZXJ5OiAnJyxcblx0fTtcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XG5cblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMgKSB7XG5cblx0XHR2bS5tb3ZpZUl0ZW1zID0gbW92SXRlbXM7XG5cdFx0aGVsaXgubWFrZUhlbGl4UG9zdGVycyggbW92SXRlbXMuc2xpY2UoIFRNRGIucHJldlJlc3VsdExlbiApLCBUTURiLnByZXZSZXN1bHRMZW4gKTtcblxuXHR9LCB0cnVlICk7XG5cblx0dmFyIHByZXZRdWVyeSA9ICcnO1xuXHR2bS5zZWFyY2ggPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCB2bS5zZWFyY2gucXVlcnkgPT09ICcnICkgcmV0dXJuO1xuXHRcdGlmICggcHJldlF1ZXJ5ICE9PSB2bS5zZWFyY2gucXVlcnkgKSB7XG5cdFx0XHRwcmV2UXVlcnkgPSB2bS5zZWFyY2gucXVlcnk7XG5cdFx0XHRUTURiLmNsZWFyU2VhcmNoKCk7XG5cdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXG5cdEVWVC5FT1AubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdyZWNpZXZlZCBFT1AgZXZlbnQhJyApO1xuXHR9ICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJyRjYWNoZUZhY3RvcnknLCAnbW92aWVJdGVtJyxcclxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0gKSB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVJdGVtID0gbW92aWVJdGVtOyAvLyBtb3ZpZUl0ZW0gaW5qZWN0ZWQgdmlhIHN0YXRlIHJlc29sdmVcclxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XHJcblxyXG5cdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGU7XHJcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcclxuXHRcdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGUgKyAnICgnICsgbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICsgJyknO1xyXG5cdH1cclxuXHJcblx0aWYgKCBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aCApIHtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC9vcmlnaW5hbCcgKyBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aDtcclxuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XHJcblx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHR2bS5hZGRUb0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRjb25zb2xlLmxvZyggbW92aWVJdGVtLmlkICk7XHJcblx0XHQvLyBwcm9tcHQgdXAgY29sbGVjdGlvbiBtb2RhbCAtPiBmZXRjaCB1c3IncyBjb2xsZWN0aW9uIC0+IGFsbG93IHVzZXIgdG8gc2VsZWN0IHdoaWNoIGNvbGxlY3Rpb24gdG8gYWRkIHRvIC0+IHNhdmUgdG8gREJcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xyXG5cdFx0dmFyIF90aGlzID0gdGhpcyxcclxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcclxuXHJcblx0XHR2YXIgdGltZW91dDtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxyXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xyXG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcclxuXHJcblx0XHRcdFx0dGltZW91dCA9IG51bGw7XHJcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcclxuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XHJcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xyXG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGRlYm91bmNlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIl19
