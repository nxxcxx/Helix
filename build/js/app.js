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
		// todo dont put exisiting item in db ( UPSERT )
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
				movieIdCache.put(res.data.id, res.data);
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

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('info', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

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
			log.debug('info', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					console.log(item.id, item);
					movieIdCache.put(item.id, item);
					// putItemToDB( item );
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('searchByTitle:', err);
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
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
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

			deferred.resolve(true);
		} else {

			$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

				log.debug('info', 'auth.authorize():', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve(true);
			}, function (err) {

				log.debug('warn', 'authorize', err, err.data);
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

		if (config.requireAuth) {
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
			log.debug('info', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('warn', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('info', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('info', 'Registered.', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('warn', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],8:[function(require,module,exports){
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
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		}

	};

	return EVT;
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

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace('info', 'err', 'auth');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
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
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	});
}];

},{}],14:[function(require,module,exports){
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

},{}],15:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
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
		$$.width = $(window).width();
		$$.height = $(window).height();
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

},{}],16:[function(require,module,exports){
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

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

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
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],18:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./helix/display.dir.js":14,"./helix/engine.fac.js":15,"./helix/helix.fac.js":16,"./helix/poster.dir.js":17,"./main.ctrl.js":19,"./movieCollection/collectionItem.dir.js":20,"./movieCollection/collectionModal.dir.js":21,"./movieCollection/collectionModalService.fac.js":22,"./movieCollection/movieCollection.ctrl.js":23,"./movieCollection/movieCollection.fac.js":24,"./movieDetail.ctrl.js":25}],19:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state) {

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
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w154/' + res.poster_path;
			$element.css({
				'width': '50px',
				'height': '70px',
				'background-repeat': 'no-repeat',
				'background-size': '50px 70px',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

		function ctrl($scope, $element, $attrs) {

				var vm = this;
				vm.movieCollection = movieCollection;
				vm.collectionModalService = collectionModalService;

				vm.addingNewCollection = false;

				vm.openEditor = function () {
						vm.addingNewCollection = true;
				};

				vm.closeEditor = function () {
						vm.addingNewCollection = false;
				};

				vm.createNewCollection = function () {
						movieCollection.create($scope.newCollectionName);
						vm.closeEditor();
				};

				vm.addToCollection = function (movieId, collectionName) {
						log.debug('info', 'addToCollection:', movieId, collectionName);
						var success = movieCollection.push(movieId, collectionName);
						log.debug('info', 'movieCollection.push', success);
				};

				// default css at directive initialization
				$element.css({ visibility: 'hidden' });

				EVT.collectionModalOpen.listen(function () {
						log.debug('info', 'collectionModalOpen');
						$element.css({ visibility: 'visible' });
				});

				EVT.collectionModalClose.listen(function () {
						log.debug('info', 'collectionModalClose');
						$element.css({ visibility: 'hidden' });
				});
		}

		return {

				restrict: 'E',
				scope: {},
				controller: ctrl,
				controllerAs: 'modal',
				replace: true,
				templateUrl: './template/collectionModal.html'

		};
}];

},{}],22:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', function (log, EVT) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		EVT.collectionModalOpen.emit();
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', function (log, $scope, auth, movieCollection) {

	window.movieCollection = movieCollection;
	log.debug('info', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;
}];

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
		// collection needs to be resolved first
		// todo check if collection is alredy exists
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('info', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('warn', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('info', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	/* collections needs to be resolved first
 update local collection
 */
	function push(itemId, toCollection) {
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
				put();
				return removed !== 0;
			}
		}
		return false;
	}

	function sync() {
		// sync local colelction w/ DB
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug('info', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService) {

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

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}]},{},[18])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9BUEkvVE1EYi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoVG9rZW4uZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWduaW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWdudXAuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbW1vbi9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbW1vbi91dGlsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29uZmlnL2h0dHBDb25maWcuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29uZmlnL3JvdXRlQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZURldGFpbC5jdHJsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQSxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUMzRixVQUFXLEdBQUcsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRzs7QUFFdkUsS0FBSSxZQUFZLEdBQUcsRUFBRSxDQUFDO0FBQ3RCLEtBQUksYUFBYSxHQUFHLENBQUMsQ0FBQztBQUN0QixLQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNwQixLQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7O0FBRWpCLEtBQUksWUFBWSxHQUFHLGFBQWEsQ0FBRSxjQUFjLENBQUUsQ0FBQzs7O0FBR25ELEtBQUksV0FBVyxHQUFHLFlBQVksR0FBRyxRQUFRLENBQUM7O0FBRTFDLFVBQVMsV0FBVyxDQUFFLFNBQVMsRUFBRzs7QUFFakMsT0FBSyxDQUFDLEdBQUcsQ0FBRSxXQUFXLEdBQUcsU0FBUyxDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUUsQ0FDakQsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3ZCLE1BQUcsQ0FBQyxLQUFLLENBQUUsTUFBTSxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUUsQ0FBQztHQUNqQyxFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUUsQ0FBQztHQUNoQyxDQUFFLENBQUM7RUFDSjs7QUFFRCxVQUFTLGNBQWMsQ0FBRSxFQUFFLEVBQUc7QUFDN0IsTUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBRSxXQUFXLEdBQUcsRUFBRSxDQUFFLENBQzFDLElBQUksQ0FBRSxVQUFXLEdBQUcsRUFBRztBQUN2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Q0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxyXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XHJcblxyXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcclxuXHR2YXIgcHJldlJlc3VsdExlbiA9IDA7XHJcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcclxuXHR2YXIgY3VyclBhZ2UgPSAxO1xyXG5cclxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcclxuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xyXG5cclxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xyXG5cdFx0Ly8gdG9kbyBkb250IHB1dCBleGlzaXRpbmcgaXRlbSBpbiBkYiAoIFVQU0VSVCApXHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ1BVVDonLCByZXMgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnUFVUOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIERCX0VORFBPSU5UICsgaWQgKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcclxuXHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCByZXMuZGF0YS5pZCwgcmVzLmRhdGEgKTtcclxuXHRcdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IERCOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIFRNREJfQVBJLnVybCArICdtb3ZpZS8nICsgaWQsIHtcclxuXHRcdFx0cGFyYW1zOiB7IGFwaV9rZXk6IFRNREJfQVBJLmtleSB9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xyXG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcclxuXHJcblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xyXG5cdFx0dmFyIGRmX1JlcyA9ICRxLmRlZmVyKCk7XHJcblxyXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xyXG5cdFx0aWYgKCBjYWNoZWRJdGVtICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gY2FjaGU6JywgY2FjaGVkSXRlbSApO1xyXG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggY2FjaGVkSXRlbSApO1xyXG5cdFx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblx0XHR9XHJcblxyXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGlmICggcmVzICkge1xyXG5cdFx0XHRcdGRmX0RCLnJlc29sdmUoIHJlcyApO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdGRmX0RCLnJlamVjdCggJ25vdCBmb3VuZCcgKTtcclxuXHRcdFx0fVxyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRkZl9EQi5wcm9taXNlLnRoZW4oIGZ1bmN0aW9uICggcmVzX0RCICkge1xyXG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX0RCICk7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0c2VhcmNoSWRGcm9tQVBJKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX2FwaSApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XHJcblx0XHRcdFx0ZGZfUmVzLnJlamVjdCggZXJyX2FwaSApO1xyXG5cdFx0XHR9ICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcclxuXHJcblx0XHRpZiAoIGN1cnJQYWdlID4gdG90YWxQYWdlcyAmJiB0b3RhbFBhZ2VzICE9PSAtMSApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxyXG5cdFx0XHRFVlQuRU9QLmVtaXQoKTtcclxuXHRcdFx0cmV0dXJuO1xyXG5cdFx0fVxyXG5cclxuXHRcdCRodHRwKCB7XHJcblx0XHRcdG1ldGhvZDogJ0dFVCcsXHJcblx0XHRcdGNhY2hlOiB0cnVlLFxyXG5cdFx0XHR1cmw6IFRNREJfQVBJLnVybCArICdzZWFyY2gvbW92aWUnLFxyXG5cdFx0XHRwYXJhbXM6e1xyXG5cdFx0XHRcdGFwaV9rZXk6IFRNREJfQVBJLmtleSxcclxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxyXG5cdFx0XHRcdHBhZ2U6IGN1cnJQYWdlXHJcblx0XHRcdH1cclxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggc3VjY2Vzc1xyXG5cdFx0XHRzZWFyY2hSZXN1bHQgPSBzZWFyY2hSZXN1bHQuY29uY2F0KCByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXMuZGF0YS5yZXN1bHRzICkgKTtcclxuXHRcdFx0dG90YWxQYWdlcyA9IHJlcy5kYXRhLnRvdGFsX3BhZ2VzO1xyXG5cdFx0XHRjdXJyUGFnZSArKztcclxuXHRcdFx0cHJldlJlc3VsdExlbiA9IHNlYXJjaFJlc3VsdC5sZW5ndGg7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlUaXRsZTonLCByZXMsIHJlcy5kYXRhICk7XHJcblxyXG5cdFx0XHQvLyBjYWNoZVxyXG5cdFx0XHRyZXMuZGF0YS5yZXN1bHRzLmZvckVhY2goIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHJcblx0XHRcdFx0aWYgKCAhbW92aWVJZENhY2hlLmdldCggaXRlbS5pZCApICkge1xyXG5cdFx0XHRcdFx0Y29uc29sZS5sb2coIGl0ZW0uaWQsIGl0ZW0gKTtcclxuXHRcdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIGl0ZW0uaWQsIGl0ZW0gKTtcclxuXHRcdFx0XHRcdC8vIHB1dEl0ZW1Ub0RCKCBpdGVtICk7XHJcblx0XHRcdFx0fVxyXG5cclxuXHRcdFx0fSApO1xyXG5cclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBlcnJcclxuXHRcdFx0bG9nLmRlYnVnKCAnc2VhcmNoQnlUaXRsZTonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXN1bHRzICkge1xyXG5cdFx0cmV0dXJuIHJlc3VsdHMuZmlsdGVyKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblx0XHRcdHJldHVybiAhIWl0ZW0ucG9zdGVyX3BhdGg7XHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRSZXMoKSB7XHJcblx0XHRyZXR1cm4gc2VhcmNoUmVzdWx0O1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gY2xlYXJTZWFyY2goKSB7XHJcblx0XHQvLyBlbWl0IGV2ZW50IGNsZWFyU2VhY2hcclxuXHRcdHNlYXJjaFJlc3VsdC5sZW5ndGggPSAwO1xyXG5cdFx0cHJldlJlc3VsdExlbiA9IDA7XHJcblx0XHR0b3RhbFBhZ2VzID0gLTE7XHJcblx0XHRjdXJyUGFnZSA9IDE7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2VhcmNoQnlUaXRsZSxcclxuXHRcdHNlYXJjaEJ5SWQsXHJcblx0XHRjbGVhclNlYXJjaCxcclxuXHRcdGdldFJlcyxcclxuXHRcdHByZXZSZXN1bHRMZW4sXHJcblx0XHRwdXRJdGVtVG9EQixcclxuXHRcdG1vdmllSWRDYWNoZVxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsICdhdXRoVG9rZW4nLFxuZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxLCBhdXRoVG9rZW4gKSB7XG5cblx0XHR2YXIgaWRlbnRpdHkgPSBudWxsO1xuXHRcdHZhciBfaWRlbnRpdHlSZXNvbHZlZCA9IGZhbHNlO1xuXG5cdFx0ZnVuY3Rpb24gYXV0aG9yaXplKCBmb3JjZSApIHtcblxuXHRcdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdFx0aWYgKCBmb3JjZSApIGlkZW50aXR5ID0gbnVsbDtcblxuXHRcdFx0aWYgKCBpZGVudGl0eSAhPT0gbnVsbCApIHtcblxuXHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdH0gZWxzZSB7XG5cblx0XHRcdFx0JGh0dHAuZ2V0KCBFTkRQT0lOVF9VUkkgKyAnYXV0aCcsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2F1dGguYXV0aG9yaXplKCk6JywgcmVzLCByZXMuZGF0YSApO1xuXHRcdFx0XHRcdFx0aWRlbnRpdHkgPSByZXMuZGF0YTtcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2F1dGhvcml6ZScsIGVyciwgZXJyLmRhdGEgKTtcblx0XHRcdFx0XHRcdC8vIHRvZG8gaWYgand0IGV4cGlyZWQgLCBkZWF1dGhvcml6ZSwgcmVtb3ZlIGxvY2FsIHN0b3JhZ2UsIHJlZGlyZWN0XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXG5cdFx0XHRcdFx0fSApO1xuXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZGVhdXRob3JpemUoKSB7XG5cdFx0XHRhdXRoVG9rZW4ucmVtb3ZlVG9rZW4oKTtcblx0XHRcdGlkZW50aXR5ID0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpc0F1dGhlbnRpY2F0ZWQoKSB7XG5cdFx0XHRyZXR1cm4gaWRlbnRpdHkgIT09IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaWRlbnRpdHlSZXNvbHZlZCgpIHtcblx0XHRcdHJldHVybiBfaWRlbnRpdHlSZXNvbHZlZDtcblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXG5cdFx0XHRhdXRob3JpemUsXG5cdFx0XHRkZWF1dGhvcml6ZSxcblx0XHRcdGlzQXV0aGVudGljYXRlZCxcblx0XHRcdGlkZW50aXR5UmVzb2x2ZWRcblxuXHRcdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XG5cblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xuXG5cdFx0aWYgKCBjb25maWcucmVxdWlyZUF1dGggKSB7XG5cdFx0XHR2YXIgdG9rZW4gPSBhdXRoVG9rZW4uZ2V0VG9rZW4oKTtcblx0XHRcdGlmICggdG9rZW4gKSB7XG5cdFx0XHRcdC8vIGh0dHA6Ly9zZWxmLWlzc3VlZC5pbmZvL2RvY3MvZHJhZnQtaWV0Zi1vYXV0aC12Mi1iZWFyZXIuaHRtbCAgIHNlY3Rpb24gMi4xXG5cdFx0XHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL2dtYWlsL21hcmt1cC9hY3Rpb25zL3ZlcmlmeWluZy1iZWFyZXItdG9rZW5zXG5cdFx0XHRcdC8vIGh0dHA6Ly93d3cudzMub3JnL1Byb3RvY29scy9yZmMyNjE2L3JmYzI2MTYtc2VjNC5odG1sIHNlY3Rpb24gNC4yIGhlYWRlciBmaWVsZCBuYW1lIGNhc2UgaW5zZW5zaXRpdmVcblx0XHRcdFx0Y29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBjb25maWc7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc3BvbnNlKCByZXMgKSB7XG5cdFx0cmV0dXJuIHJlcztcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRyZXF1ZXN0LFxuXHRcdHJlc3BvbnNlXG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckd2luZG93JywgZnVuY3Rpb24gKCBsb2csICR3aW5kb3cgKSB7XG5cblx0dmFyIHN0b3JhZ2UgPSAkd2luZG93LmxvY2FsU3RvcmFnZTtcblx0dmFyIGNhY2hlZFRva2VuID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRUb2tlbiggdG9rZW4gKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSB0b2tlbjtcblx0XHRzdG9yYWdlLnNldEl0ZW0oICdqd3QnLCB0b2tlbiApO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0VG9rZW4oKSB7XG5cdFx0aWYgKCAhY2FjaGVkVG9rZW4gKSB7XG5cdFx0XHRjYWNoZWRUb2tlbiA9IHN0b3JhZ2UuZ2V0SXRlbSggJ2p3dCcgKTtcblx0XHR9XG5cdFx0cmV0dXJuIGNhY2hlZFRva2VuO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlVG9rZW4oKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSBudWxsO1xuXHRcdHN0b3JhZ2UucmVtb3ZlSXRlbSggJ2p3dCcgKTtcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3Rva2VuIHJlbW92ZWQnICk7XG5cdH1cblxuXHRmdW5jdGlvbiBoYXNUb2tlbigpIHtcblx0XHRyZXR1cm4gISFnZXRUb2tlbigpO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHNldFRva2VuLFxuXHRcdGdldFRva2VuLFxuXHRcdHJlbW92ZVRva2VuLFxuXHRcdGhhc1Rva2VuXG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0udXNlciA9IHtcclxuXHRcdGVtYWlsOiAnJyxcclxuXHRcdHBhc3N3b3JkOiAnJ1xyXG5cdH07XHJcblxyXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xyXG5cclxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XHJcblx0XHRcdHJldHVybjtcclxuXHRcdH1cclxuXHJcblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2lnbmluJywgcmVzLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdzaWduaW4nLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XHJcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdSZWdpc3RlcmVkLicsIHJlcyApO1xyXG5cclxuXHRcdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XHJcblxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsIGVyciApO1xuXHRcdFx0XHRcdHZtLmZvcm0uJHN1Ym1pdHRlZCA9IGZhbHNlO1xyXG5cblx0XHRcdFx0fSApO1xyXG5cblx0XHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcclxuXHJcblx0dmFyIEVWVCA9IHtcclxuXHJcblx0XHRFT1A6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XHJcblx0XHR9LFxyXG5cdFx0Y29sbGVjdGlvbk1vZGFsT3Blbjoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsT3BlbicsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTsgfVxyXG5cdFx0fSxcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbENsb3NlOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxDbG9zZScsIGNiICk7IH0sXHJcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7IH1cclxuXHRcdH1cclxuXHJcblx0fTtcclxuXHJcblx0cmV0dXJuIEVWVDtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHR2YXIgZGVidWdFbmFibGVkID0gZmFsc2U7XG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcblxuXHR0aGlzLmVuYWJsZURlYnVnID0gZnVuY3Rpb24gKCkge1xuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XG5cdH07XG5cblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XG5cdFx0XHRkZWJ1Z05hbWVzcGFjZXMucHVzaCggYXJndW1lbnRzWyBpIF0gKTtcblx0XHR9XG5cdH07XG5cblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoKSB7XG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XHJcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcclxuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XHJcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lc3BhY2VzLmluZGV4T2YoIGRlYnVnTmFtZSApICE9PSAtMSApIHtcclxuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cdFx0XHRkZWJ1Z1xuXHRcdH07XG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xyXG5cclxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xyXG5cdFx0dmFyIF90aGlzID0gdGhpcyxcclxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcclxuXHJcblx0XHR2YXIgdGltZW91dDtcclxuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxyXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xyXG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcclxuXHJcblx0XHRcdFx0dGltZW91dCA9IG51bGw7XHJcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0XHR9O1xyXG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcclxuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XHJcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xyXG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHR9O1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGRlYm91bmNlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCAkaHR0cFByb3ZpZGVyICkge1xyXG5cdCRodHRwUHJvdmlkZXIuaW50ZXJjZXB0b3JzLnB1c2goICdhdXRoSW50ZXJjZXB0b3InICk7XHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcclxuXHJcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcclxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJywgJ2F1dGgnICk7XHJcblxyXG5cdCRodHRwUHJvdmlkZXIudXNlTGVnYWN5UHJvbWlzZUV4dGVuc2lvbnMoIGZhbHNlICk7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxyXG5mdW5jdGlvbiAoICRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XHJcblxyXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xyXG5cclxuXHQkc3RhdGVQcm92aWRlclxyXG5cdFx0LnN0YXRlKCAnaGVsaXgnLCB7XHJcblx0XHRcdHVybDogJy8nLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvaGVsaXguaHRtbCdcclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnc2lnbnVwJywge1xyXG5cdFx0XHR1cmw6ICcvc2lnbnVwJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ251cC5odG1sJyxcclxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ251cEN0cmwnLFxyXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWdudXAnXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ3NpZ25pbicsIHtcclxuXHRcdFx0dXJsOiAnL3NpZ25pbicsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWduaW4uaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWduaW5DdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbmluJ1xyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoICdzaWdub3V0Jywge1xyXG5cdFx0XHR1cmw6ICcvc2lnbm91dCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdub3V0Q3RybCdcclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnbW92aWVEZXRhaWwnLCB7XHJcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9tb3ZpZURldGFpbC5odG1sJyxcclxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllRGV0YWlsQ3RybCcsXHJcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcclxuXHRcdFx0cmVzb2x2ZToge1xyXG5cdFx0XHRcdG1vdmllSXRlbTogWyAnJHN0YXRlUGFyYW1zJywgJ1RNRGInLCBmdW5jdGlvbiAoICRzdGF0ZVBhcmFtcywgVE1EYiApIHtcclxuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XHJcblx0XHRcdFx0fSBdXHJcblx0XHRcdH1cclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCdjb2xsZWN0aW9uJywge1xyXG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbicsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVDb2xsZWN0aW9uQ3RybCcsXHJcblx0XHRcdGNvbnRyb2xsZXJBczogJ21jJyxcclxuXHRcdFx0cmVzb2x2ZToge1xyXG5cdFx0XHRcdGF1dGhvcml6ZTogWyAnYXV0aCcsIGZ1bmN0aW9uICggYXV0aCApIHtcclxuXHRcdFx0XHRcdHJldHVybiBhdXRoLmF1dGhvcml6ZSgpO1xyXG5cdFx0XHRcdH0gXSxcclxuXHRcdFx0XHRyZXNvbHZlZENvbGxlY3Rpb246IFsgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbW92aWVDb2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdFx0cmV0dXJuIG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xyXG5cdFx0XHRcdH0gXVxyXG5cdFx0XHR9XHJcblx0XHR9KVxyXG5cdDtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgJ0VOR0lORScsICd1dGlsJywgZnVuY3Rpb24gKCAkd2luZG93LCBFTkdJTkUsIHV0aWwgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxuXHRcdEVOR0lORS5hdHRhY2hSZW5kZXJlciggJGVsZW1lbnQgKTtcclxuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKTtcclxuXHRcdCRlbGVtZW50Lm9uKCAnd2hlZWwnLCBmdW5jdGlvbiAoIGV2dCApIHtcblx0XHRcdEVOR0lORS4kJC53aGVlbF9keSA9IC1NYXRoLnNpZ24oIGV2dC5vcmlnaW5hbEV2ZW50LmRlbHRhWSApO1xuXHRcdH0gKTtcblxyXG5cdFx0RU5HSU5FLnN0YXJ0KCk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGlkPVwiY2FudmFzLWNvbnRhaW5lclwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCBmdW5jdGlvbiAoICR3aW5kb3cgKSB7XG5cblx0dmFyICQkID0ge1xuXHRcdGNhbnZhczogbnVsbCxcblx0XHRzdGF0czogbmV3IFN0YXRzKCksXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxuXHRcdHdpZHRoOiAkKHdpbmRvdykud2lkdGgoKSxcblx0XHRoZWlnaHQ6ICQod2luZG93KS5oZWlnaHQoKSxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xuXHRcdCQkLmhlaWdodCA9ICQod2luZG93KS5oZWlnaHQoKTtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcclxuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cclxuXHRcdHZhciB2ZWN0b3IgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xyXG5cdFx0dmFyIHJhZGl1cyA9IDkwMDtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XHJcblxyXG5cdFx0XHR2YXIgcG9zdGVyRGlyZWN0aXZlRWxlbSA9ICRjb21waWxlKCAnPHBvc3Rlcj48L3Bvc3Rlcj4nICkoICRpc29sYXRlZFNjb3BlIClbIDAgXTtcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xyXG5cclxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XHJcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XHJcblxyXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcblx0XHRcdHZhciBwaGkgPSBoaWR4ICogMC4xNzUgKyBNYXRoLlBJO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi54ID0gLSByYWRpdXMgKiBNYXRoLnNpbiggcGhpICk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueiA9IHJhZGl1cyAqIE1hdGguY29zKCBwaGkgKTtcclxuXHJcblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XHJcblxuXHRcdFx0Y3NzM2RPYmoubG9va0F0KCB2ZWN0b3IgKTtcclxuXHRcdFx0YWxsUG9zdGVycy5hZGQoIGNzczNkT2JqICk7XG5cblx0XHR9XG5cblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xyXG5cclxuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJBbGwoKSB7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmZvckVhY2goIGZ1bmN0aW9uICggcG9zdGVyICkge1xyXG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcclxuXHRcdFx0cG9zdGVyLnNjb3BlLiRkZXN0cm95KCk7XHJcblx0XHR9ICk7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXHJcblx0fVxyXG5cblx0cmV0dXJuIHtcblx0XHRtYWtlSGVsaXhQb3N0ZXJzLFxuXHRcdGNsZWFyQWxsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIGZ1bmN0aW9uICggJHN0YXRlLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xyXG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxyXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xyXG5cdFx0dmFyIGltZyA9IG5ldyBJbWFnZSgpO1xyXG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3cxNTQvJyArICRzY29wZS5tb3ZpZUl0ZW0ucG9zdGVyX3BhdGg7XHJcblx0XHRpbWcub25sb2FkID0gZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdFx0Ly8gdG9kbyBtb3ZlIGNzcyBpbnRvIHNhc3MsIHVzZSBjbGFzcyBpbnN0ZWFkXHJcblx0XHRcdCRlbGVtZW50LmNzcygge1xyXG5cdFx0XHRcdCd3aWR0aCc6ICcxNTBweCcsXHJcblx0XHRcdFx0J2hlaWdodCc6ICcyMzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxNTBweCAyMzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKScsXHJcblx0XHRcdFx0J2Rpc3BsYXknOiAnbm9uZScgLy8gcmVxdWlyZWQgZm9yIGZhZGVJbiBhbmltYXRpb25cclxuXHRcdFx0fSApO1xyXG5cdFx0XHQkZWxlbWVudC5mYWRlSW4oIDE1MDAgKTtcclxuXHJcblx0XHR9O1xyXG5cdFx0aW1nLnNyYyA9IGltZ1VybDtcclxuXG5cdFx0JGVsZW1lbnQub24oICdjbGljaycsIGZ1bmN0aW9uICggZXZ0ICkge1xyXG5cdFx0XHQkc3RhdGUuZ28oICdtb3ZpZURldGFpbCcsIHsgbW92aWVJZDogJHNjb3BlLm1vdmllSXRlbS5pZCB9ICk7XHJcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggJHNjb3BlLm1vdmllSXRlbSApO1xyXG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9jb21tb24vbG9nLnB2LmpzJyApIClcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vY29tbW9uL2V2ZW50cy5mYWMuanMnICkgKVxuXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdkaXNwbGF5JywgcmVxdWlyZSggJy4vaGVsaXgvZGlzcGxheS5kaXIuanMnICkgKVxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllQ29sbGVjdGlvbkN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25Nb2RhbCcsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxuXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvcm91dGVDb25maWcuanMnICkgKVxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2xvZ0NvbmZpZy5qcycgKSApXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvaHR0cENvbmZpZy5qcycgKSApXG4ucnVuKCBbICdsb2cnLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cblx0YXV0aC5hdXRob3JpemUoIHRydWUgKTtcblxuXHRtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcblxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XG5cblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpOyAvLyBwcmV2ZW50IHRyYW5zaXRpb25cblx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyb3IgKTtcblx0XHRpZiAoIGVycm9yICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXHRcdH1cblxuXHR9ICk7XG5cbn0gXSApXG47XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICdFVlQnLCAnaGVsaXgnLCAnRU5HSU5FJywgJ2F1dGgnLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCwgJHN0YXRlICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLmF1dGggPSBhdXRoO1xuXHR2bS5zZWFyY2ggPSB7XG5cdFx0cXVlcnk6ICcnLFxuXHR9O1xuXHR2bS5tb3ZpZUl0ZW1zID0gbnVsbDtcblxuXHQkc2NvcGUuJHdhdGNoKCBUTURiLmdldFJlcywgZnVuY3Rpb24gKCBtb3ZJdGVtcyApIHtcblxuXHRcdHZtLm1vdmllSXRlbXMgPSBtb3ZJdGVtcztcblx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBtb3ZJdGVtcy5zbGljZSggVE1EYi5wcmV2UmVzdWx0TGVuICksIFRNRGIucHJldlJlc3VsdExlbiApO1xuXG5cdH0sIHRydWUgKTtcblxuXHR2YXIgcHJldlF1ZXJ5ID0gJyc7XG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XG5cdFx0aWYgKCBwcmV2UXVlcnkgIT09IHZtLnNlYXJjaC5xdWVyeSApIHtcblx0XHRcdHByZXZRdWVyeSA9IHZtLnNlYXJjaC5xdWVyeTtcblx0XHRcdFRNRGIuY2xlYXJTZWFyY2goKTtcblx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XG5cdFx0XHRFTkdJTkUucmVzZXRDYW1lcmEoKTtcblx0XHR9XG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXHR2bS5TVEFURSA9ICRzdGF0ZTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGF0dHJzLCAkZWxlbWVudCApIHtcclxuXHJcblx0XHRUTURiLnNlYXJjaEJ5SWQoIHBhcnNlSW50KCAkc2NvcGUubW92aWVJZCApIClcclxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHJcblx0XHRcdC8vIGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCByZXMgKTtcclxuXHRcdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3cxNTQvJyArIHJlcy5wb3N0ZXJfcGF0aDtcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnNzBweCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICc1MHB4IDcwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHJlc3RyaWN0OiAnRScsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0c2NvcGU6IHsgbW92aWVJZDogJ0AnIH0sXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2PjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdtb3ZpZUNvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQsICRhdHRycyApIHtcclxuXHJcblx0XHR2YXIgdm0gPSB0aGlzO1xyXG5cdFx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XHJcblxyXG5cdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cclxuXHRcdHZtLm9wZW5FZGl0b3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSB0cnVlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jbG9zZUVkaXRvciA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRtb3ZpZUNvbGxlY3Rpb24uY3JlYXRlKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dm0uY2xvc2VFZGl0b3IoKTtcclxuXHRcdH07XHJcblxyXG5cdFx0dm0uYWRkVG9Db2xsZWN0aW9uID0gZnVuY3Rpb24gKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdhZGRUb0NvbGxlY3Rpb246JywgbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdtb3ZpZUNvbGxlY3Rpb24ucHVzaCcsIHN1Y2Nlc3MgKTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHNjb3BlOiB7fSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCBmdW5jdGlvbiAoIGxvZywgRVZUICkge1xyXG5cclxuXHR2YXIgYWN0aXZlSXRlbSA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIHNldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRhY3RpdmVJdGVtID0gaXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRyZXR1cm4gYWN0aXZlSXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIG9wZW4oKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxDbG9zZS5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2V0QWN0aXZlSXRlbSxcclxuXHRcdGdldEFjdGl2ZUl0ZW0sXHJcblx0XHRvcGVuLFxyXG5cdFx0Y2xvc2VcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHR3aW5kb3cubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbkN0cmwnLCBtb3ZpZUNvbGxlY3Rpb24uZ2V0Q29sbGVjdGlvbigpICk7XHJcblx0dmFyIHZtID0gdGhpcztcclxuXHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsIGZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSApIHtcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ2NvbGxlY3Rpb24nO1xyXG5cdHZhciBjb2xsZWN0aW9uID0gbnVsbDtcclxuXHJcblx0dmFyIGZ1bGxDb2xsZWN0aW9uID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xyXG5cdFx0Ly8gY29sbGVjdGlvbiBuZWVkcyB0byBiZSByZXNvbHZlZCBmaXJzdFxyXG5cdFx0Ly8gdG9kbyBjaGVjayBpZiBjb2xsZWN0aW9uIGlzIGFscmVkeSBleGlzdHNcclxuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XHJcblx0XHRwdXQoKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGlzRW1wdHkoKSB7XHJcblx0XHRyZXR1cm4gY29sbGVjdGlvbi5sZW5ndGggPT09IDA7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZXNvbHZlQ29sbGVjdGlvbigpIHtcclxuXHJcblx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcclxuXHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggY29sbGVjdGlvbiApO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCByZXMgKTtcclxuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSByZXMuZGF0YTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcclxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xyXG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcclxuXHRcdFx0XHR9ICk7XHJcblx0XHR9XHJcblxyXG5cdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHNvbWVDb2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcclxuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBwdXQoKSB7XHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5ULCBjb2xsZWN0aW9uLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uLnB1dCgpOicsIHJlcyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cdH1cclxuXHJcblx0LyogY29sbGVjdGlvbnMgbmVlZHMgdG8gYmUgcmVzb2x2ZWQgZmlyc3RcclxuXHR1cGRhdGUgbG9jYWwgY29sbGVjdGlvblxyXG5cdCovXHJcblx0ZnVuY3Rpb24gcHVzaCggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSB7XHJcblx0XHRpZiAoIGhhc0l0ZW0oIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkgKSB7XHJcblx0XHRcdHJldHVybiBmYWxzZTtcclxuXHRcdH1cclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRjb2xsZWN0aW9uW2ldLm1vdmllcy5wdXNoKCBpdGVtSWQgKTtcclxuXHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGluQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XHJcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XHJcblx0XHRcdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbltpXS5tb3ZpZXMuc3BsaWNlKCBrLCAxICkubGVuZ3RoO1xyXG5cdFx0XHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdFx0XHR9XHJcblx0XHRcdFx0fVxyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xyXG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XHJcblx0XHRcdFx0cHV0KCk7XHJcblx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHN5bmMoKSB7XHJcblx0XHQvLyBzeW5jIGxvY2FsIGNvbGVsY3Rpb24gdy8gREJcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldENvbGxlY3Rpb24oKSB7XHJcblx0XHRyZXR1cm4gY29sbGVjdGlvbjtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIF9jbGVhcigpIHtcclxuXHRcdGNvbGxlY3Rpb24gPSBudWxsO1xyXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdsb2NhbCBjb2xsZWN0aW9uIGNsZWFyZWQuJyApO1xyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdGdldENvbGxlY3Rpb24sXHJcblx0XHRjcmVhdGUsXHJcblx0XHRwdXNoLFxyXG5cdFx0cHV0LFxyXG5cdFx0cmVtb3ZlLFxyXG5cdFx0cmVtb3ZlQ29sbGVjdGlvbixcclxuXHRcdHN5bmMsXHJcblx0XHRfY2xlYXIsXHJcblx0XHRyZXNvbHZlQ29sbGVjdGlvbixcclxuXHRcdGhhc0l0ZW0sXHJcblx0XHRpc0VtcHR5XHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnJGNhY2hlRmFjdG9yeScsICdtb3ZpZUl0ZW0nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllSXRlbSA9IG1vdmllSXRlbTsgLy8gbW92aWVJdGVtIGluamVjdGVkIHZpYSBzdGF0ZSByZXNvbHZlXHJcblx0bG9nLmRlYnVnKCAnY3RybCcsICdtb3ZpZURldGFpbCBjdHJsIHJlc29sdmVkOicsIHZtLm1vdmllSXRlbSApO1xyXG5cclxuXHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlO1xyXG5cdGlmICggbW92aWVJdGVtLnRpdGxlICE9PSBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKSB7XHJcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcclxuXHR9XHJcblxyXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3Avb3JpZ2luYWwnICsgbW92aWVJdGVtLmJhY2tkcm9wX3BhdGg7XHJcblx0XHQkKCAnLmJhY2tkcm9wJyApLmNzcygge1xyXG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcblx0dm0ub3BlbkNvbGxlY3Rpb25Nb2RhbCA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggbW92aWVJdGVtICk7XHJcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLm9wZW4oKTtcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iXX0=
